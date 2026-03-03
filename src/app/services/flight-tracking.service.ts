import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core'
import { Observable, Subscription, firstValueFrom, interval, of, startWith, switchMap } from 'rxjs'
import { catchError, map } from 'rxjs/operators'
import { FLIGHTS } from '../config/flights.config'
import { FlightConfig, FlightPathPoint, FlightState, FlightStatus, TrackedFlight, TrackingMode } from '../models/flight.model'
import { GreatCircleService } from './great-circle.service'
import { OpenSkyService } from './opensky.service'

const POLL_INTERVAL_NORMAL = 30_000    // 30 seconds – safe for anonymous rate limit
const POLL_INTERVAL_BACKOFF = 120_000  // 2 minutes – after rate limit hit
const DATA_GAP_THRESHOLD = 120_000   // 2 minutes – mark as "over-ocean"
const LANDED_THRESHOLD = 2 * 60 * 60_000 // 2 hours – if no data for this long, assume landed
const STORAGE_PREFIX = 'ft_path_'
const ICAO24_CACHE_KEY = 'ft_icao24_cache'

@Injectable({ providedIn: 'root' })
export class FlightTrackingService implements OnDestroy {
  private readonly openSky = inject(OpenSkyService);
  private readonly greatCircle = inject(GreatCircleService);

  /** All tracked flights */
  readonly trackedFlights = signal<TrackedFlight[]>(
    FLIGHTS.map(config => this.createTrackedFlight(config))
  );

  /** Currently selected flight ID */
  readonly selectedFlightId = signal<string | null>(FLIGHTS[0]?.id ?? null);

  /** The selected flight */
  readonly selectedFlight = computed(() => {
    const id = this.selectedFlightId()
    return this.trackedFlights().find(f => f.config.id === id) ?? null
  });

  /** Current tracking mode */
  readonly trackingMode = signal<TrackingMode>('off');

  /** Whether live tracking is active (convenience) */
  readonly isTracking = computed(() => this.trackingMode() === 'live');

  /** Rate limit status for UI display */
  readonly rateLimitInfo = signal('');

  /** Busy flag for manual polling */
  readonly isPolling = signal(false);

  private pollSubscription: Subscription | null = null;
  private currentPollInterval = POLL_INTERVAL_NORMAL;
  private consecutiveEmpty = 0; // Track consecutive empty responses to slow down

  constructor () {
    this.loadPaths()
    this.loadIcao24Cache()
  }

  ngOnDestroy (): void {
    this.stopTracking()
  }

  selectFlight (id: string): void {
    this.selectedFlightId.set(id)
  }

  setMode (mode: TrackingMode): void {
    // Stop any active polling first
    this.pollSubscription?.unsubscribe()
    this.pollSubscription = null
    this.rateLimitInfo.set('')
    this.trackingMode.set(mode)

    if (mode === 'live') {
      this.currentPollInterval = POLL_INTERVAL_NORMAL
      this.setupPolling()
    }
    // 'manual' and 'off' don't start automatic polling
  }

  /** Legacy convenience methods */
  startTracking (): void {
    this.setMode('live')
  }

  stopTracking (): void {
    this.setMode('off')
  }

  async pollOnce (): Promise<void> {
    this.isPolling.set(true)
    try {
      await firstValueFrom(this.doPoll())
    } finally {
      this.isPolling.set(false)
    }
  }

  private setupPolling (immediate = true): void {
    this.pollSubscription?.unsubscribe()
    const source$ = immediate
      ? interval(this.currentPollInterval).pipe(startWith(0))
      : interval(this.currentPollInterval)
    this.pollSubscription = source$.pipe(
      switchMap(() => this.doPoll())
    ).subscribe()
  }

  /**
   * Single unified poll: tries cached icao24s first (cheap request),
   * falls back to full states search only when needed.
   */
  private doPoll (): Observable<void> {
    // If rate limited, skip and show info
    if (this.openSky.isRateLimited) {
      this.rateLimitInfo.set(`Rate Limit – Pause ${this.openSky.rateLimitRemainingSeconds}s`)
      return of(undefined)
    }

    this.rateLimitInfo.set('')
    const flights = this.trackedFlights()
    const cachedIcao24s = flights
      .filter(f => f.icao24Cache)
      .map(f => f.icao24Cache!)

    // Strategy: If we have cached icao24 addresses, use targeted request (very light)
    // Otherwise, do ONE full request and search by callsigns
    if (cachedIcao24s.length > 0) {
      return this.pollViaCachedIcao24(flights, cachedIcao24s)
    }

    return this.pollViaCallsignSearch(flights)
  }

  /**
   * Efficient path: query only the specific icao24 addresses we already know.
   * This is a very small API response (~1-3 aircraft instead of ~10,000+).
   */
  private pollViaCachedIcao24 (flights: TrackedFlight[], icao24s: string[]): Observable<void> {
    console.log(`FlightTracker: Gezielte Abfrage für ${icao24s.length} ICAO24-Adressen: ${icao24s.join(', ')}`)

    return this.openSky.getStatesByIcao24(icao24s).pipe(
      map(states => {
        let foundAny = false

        for (const flight of flights) {
          if (flight.icao24Cache) {
            const state = states.find(s =>
              s.icao24 === flight.icao24Cache &&
              s.callsign.toUpperCase().replace(/\s/g, '') === flight.config.icaoCallsign.toUpperCase()
            ) ?? null
            this.updateFlightState(flight.config.id, state)
            if (state) foundAny = true
          } else {
            // No cache for this flight – leave as-is, will try full search next cycle
            this.updateFlightStatus(flight.config.id, flight.status === 'planned' ? 'planned' : 'no-data')
          }
        }

        // If no cached icao24 returned results, maybe the flights ended
        // Do a full search once to check for new flights
        if (!foundAny) {
          this.consecutiveEmpty++
          if (this.consecutiveEmpty >= 3) {
            // Clear cache and do a full search next cycle
            this.clearIcao24Cache()
            this.consecutiveEmpty = 0
          }
        } else {
          this.consecutiveEmpty = 0
        }

        // Slow down after rate limit
        if (this.openSky.isRateLimited) {
          this.switchToBackoff()
        }
      }),
      catchError(() => {
        this.switchToBackoff()
        return of(undefined)
      })
    )
  }

  /**
   * Discovery search: compute a geographic bounding box from the flight routes
   * and query only that area. MUCH smaller response than fetching all global states.
   *
   * Typical response sizes:
   * - DUS→MUC (short haul): ~100-300 aircraft
   * - SIN→SUB (short haul): ~50-200 aircraft
   * - MUC→SIN (long haul): ~2000-5000 aircraft (still way better than ~10,000+ global)
   */
  private pollViaCallsignSearch (flights: TrackedFlight[]): Observable<void> {
    const callsigns = flights.map(f => f.config.icaoCallsign)
    const bounds = this.computeRouteBounds(flights)

    return this.openSky.findFlightsInArea(callsigns, bounds).pipe(
      map(stateMap => {
        for (const flight of flights) {
          const cs = flight.config.icaoCallsign.toUpperCase().replace(/\s/g, '')
          const state = stateMap.get(cs) ?? null
          this.updateFlightState(flight.config.id, state)
        }

        if (this.openSky.isRateLimited) {
          this.switchToBackoff()
        }
      }),
      catchError(() => {
        this.switchToBackoff()
        return of(undefined)
      })
    )
  }

  /**
   * Compute a bounding box that encompasses all given flight routes.
   * Adds padding (5°) to cover deviations from the great-circle path.
   */
  private computeRouteBounds (flights: TrackedFlight[]): {
    lamin: number; lamax: number; lomin: number; lomax: number
  } {
    let lamin = 90
    let lamax = -90
    let lomin = 180
    let lomax = -180

    for (const f of flights) {
      const { fromCoords, toCoords } = f.config
      lamin = Math.min(lamin, fromCoords[0], toCoords[0])
      lamax = Math.max(lamax, fromCoords[0], toCoords[0])
      lomin = Math.min(lomin, fromCoords[1], toCoords[1])
      lomax = Math.max(lomax, fromCoords[1], toCoords[1])
    }

    // Padding for flight path deviations and approach/departure areas
    const PAD = 5
    return {
      lamin: Math.max(-90, lamin - PAD),
      lamax: Math.min(90, lamax + PAD),
      lomin: Math.max(-180, lomin - PAD),
      lomax: Math.min(180, lomax + PAD)
    }
  }

  private switchToBackoff (): void {
    console.warn('FlightTracker: Switching to backoff polling (120s)')
    this.currentPollInterval = POLL_INTERVAL_BACKOFF
    this.rateLimitInfo.set(`Rate Limit – nächster Versuch in ${Math.ceil(this.currentPollInterval / 1000)}s`)
    if (this.trackingMode() === 'live') {
      // Restart WITHOUT immediate request – let the interval wait first
      this.setupPolling(false)
    }
  }

  private updateFlightState (flightId: string, state: FlightState | null): void {
    this.trackedFlights.update(flights =>
      flights.map(f => {
        if (f.config.id !== flightId) return f

        const now = Date.now()

        if (!state) {
          // No data received
          const timeSinceLastUpdate = f.lastUpdateTime ? now - f.lastUpdateTime : null
          let status: FlightStatus = 'no-data'

          if (f.path.length === 0) {
            status = 'planned'
          } else if (timeSinceLastUpdate && timeSinceLastUpdate > LANDED_THRESHOLD) {
            // No data for 2+ hours → flight is most likely landed
            status = 'landed'
          } else if (timeSinceLastUpdate && timeSinceLastUpdate > DATA_GAP_THRESHOLD) {
            // Short gap (2 min – 2 h) → probably over ocean with no ADS-B coverage
            status = 'over-ocean'
          }

          return { ...f, status }
        }

        // Cache the icao24 address for faster subsequent lookups
        const icao24Cache = state.icao24

        // Determine status
        let status: FlightStatus
        if (state.onGround) {
          // Check if it has been in the air before (has path points)
          status = f.path.length > 0 ? 'landed' : 'planned'
        } else {
          status = 'in-air'
        }

        // Add point to path
        const newPoint: FlightPathPoint = {
          timestamp: now,
          lat: state.lat,
          lon: state.lon,
          altitude: state.baroAltitude,
          speed: state.velocity,
          heading: state.trueTrack,
          estimated: false
        }

        const path = [...f.path, newPoint]
        this.savePath(flightId, path)

        return {
          ...f,
          state,
          path,
          status,
          lastUpdateTime: now,
          icao24Cache
        }
      })
    )

    // Persist icao24 cache
    this.saveIcao24Cache()
  }

  private updateFlightStatus (flightId: string, status: FlightStatus): void {
    this.trackedFlights.update(flights =>
      flights.map(f => f.config.id === flightId ? { ...f, status } : f)
    )
  }

  /**
   * Get estimated position for a flight with data gap.
   * Uses last known position + heading + speed to extrapolate,
   * or great circle interpolation as fallback.
   */
  getEstimatedPosition (flight: TrackedFlight): [number, number] | null {
    if (!flight.lastUpdateTime || flight.path.length === 0) return null

    const lastPoint = flight.path[flight.path.length - 1]
    const elapsed = (Date.now() - flight.lastUpdateTime) / 1000 // seconds

    if (lastPoint.heading !== null && lastPoint.speed !== null && lastPoint.speed > 0) {
      return this.greatCircle.estimatePosition(
        lastPoint.lat,
        lastPoint.lon,
        lastPoint.heading,
        lastPoint.speed,
        elapsed
      )
    }

    // Fallback: great circle interpolation from last position to destination
    const totalDist = this.greatCircle.distanceKm(
      flight.config.fromCoords,
      flight.config.toCoords
    )
    const distFromStart = this.greatCircle.distanceKm(
      flight.config.fromCoords,
      [lastPoint.lat, lastPoint.lon]
    )
    const avgSpeedKmH = 850 // average cruising speed
    const additionalDist = (elapsed / 3600) * avgSpeedKmH
    const fraction = (distFromStart + additionalDist) / totalDist

    return this.greatCircle.interpolatePosition(
      flight.config.fromCoords,
      flight.config.toCoords,
      fraction
    )
  }

  getTimeSinceLastUpdate (flight: TrackedFlight): string {
    if (!flight.lastUpdateTime) return 'Keine Daten'
    const elapsed = Math.floor((Date.now() - flight.lastUpdateTime) / 1000)

    if (elapsed < 60) return `vor ${elapsed}s`
    if (elapsed < 3600) return `vor ${Math.floor(elapsed / 60)} Min.`
    return `vor ${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)} Min.`
  }

  clearPathHistory (): void {
    FLIGHTS.forEach(f => localStorage.removeItem(STORAGE_PREFIX + f.id))
    localStorage.removeItem(ICAO24_CACHE_KEY)
    this.trackedFlights.update(flights =>
      flights.map(f => ({ ...f, path: [], state: null, status: 'planned' as FlightStatus, lastUpdateTime: null, icao24Cache: null }))
    )
  }

  private clearIcao24Cache (): void {
    localStorage.removeItem(ICAO24_CACHE_KEY)
    this.trackedFlights.update(flights =>
      flights.map(f => ({ ...f, icao24Cache: null }))
    )
  }

  private createTrackedFlight (config: FlightConfig): TrackedFlight {
    return {
      config,
      state: null,
      path: [],
      status: 'planned',
      lastUpdateTime: null,
      icao24Cache: null
    }
  }

  private savePath (flightId: string, path: FlightPathPoint[]): void {
    try {
      localStorage.setItem(STORAGE_PREFIX + flightId, JSON.stringify(path))
    } catch {
      // localStorage full – silently ignore
    }
  }

  private loadPaths (): void {
    this.trackedFlights.update(flights =>
      flights.map(f => {
        try {
          const stored = localStorage.getItem(STORAGE_PREFIX + f.config.id)
          if (stored) {
            const path = JSON.parse(stored) as FlightPathPoint[]
            return {
              ...f,
              path,
              lastUpdateTime: path.length > 0 ? path[path.length - 1].timestamp : null
            }
          }
        } catch {
          // ignore parse errors
        }
        return f
      })
    )
  }

  private saveIcao24Cache (): void {
    try {
      const cache: Record<string, string> = {}
      for (const f of this.trackedFlights()) {
        if (f.icao24Cache) {
          cache[f.config.id] = f.icao24Cache
        }
      }
      localStorage.setItem(ICAO24_CACHE_KEY, JSON.stringify(cache))
    } catch {
      // ignore
    }
  }

  private loadIcao24Cache (): void {
    try {
      const stored = localStorage.getItem(ICAO24_CACHE_KEY)
      if (stored) {
        const cache = JSON.parse(stored) as Record<string, string>
        this.trackedFlights.update(flights =>
          flights.map(f => {
            const icao24 = cache[f.config.id]
            return icao24 ? { ...f, icao24Cache: icao24 } : f
          })
        )
      }
    } catch {
      // ignore
    }
  }
}
