import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { Subscription, Observable, interval, switchMap, startWith, forkJoin, of, firstValueFrom } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { OpenSkyService } from './opensky.service';
import { GreatCircleService } from './great-circle.service';
import { FlightConfig, FlightState, FlightPathPoint, FlightStatus, TrackedFlight } from '../models/flight.model';
import { FLIGHTS } from '../config/flights.config';

const POLL_INTERVAL = 15_000; // 15 seconds
const DATA_GAP_THRESHOLD = 120_000; // 2 minutes – mark as "over-ocean"
const STORAGE_PREFIX = 'ft_path_';

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
    const id = this.selectedFlightId();
    return this.trackedFlights().find(f => f.config.id === id) ?? null;
  });

  /** Whether tracking is active */
  readonly isTracking = signal(false);

  private pollSubscription: Subscription | null = null;

  constructor() {
    // Load paths from localStorage
    this.loadPaths();
  }

  ngOnDestroy(): void {
    this.stopTracking();
  }

  selectFlight(id: string): void {
    this.selectedFlightId.set(id);
  }

  startTracking(): void {
    if (this.pollSubscription) return;
    this.isTracking.set(true);

    this.pollSubscription = interval(POLL_INTERVAL).pipe(
      startWith(0),
      switchMap(() => this.pollAllFlights())
    ).subscribe();
  }

  stopTracking(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
    this.isTracking.set(false);
  }

  /**
   * Manually trigger a single poll for all flights.
   */
  async pollOnce(): Promise<void> {
    await firstValueFrom(this.doPollAllFlights());
  }

  private pollAllFlights() {
    return this.doPollAllFlights();
  }

  private doPollAllFlights(): Observable<void> {
    const flights = this.trackedFlights();

    const observables = flights.map(flight => this.pollSingleFlight(flight));

    if (observables.length === 0) return of(undefined);

    return forkJoin(observables).pipe(map(() => undefined));
  }

  private pollSingleFlight(flight: TrackedFlight): Observable<void> {
    // If we have the icao24 cached, use it directly
    if (flight.icao24Cache) {
      return this.openSky.getStates(flight.icao24Cache).pipe(
        switchMap(states => {
          const state = states?.find(s =>
            s.callsign.toUpperCase().replace(/\s/g, '') === flight.config.icaoCallsign.toUpperCase()
          ) ?? null;

          if (state) {
            this.updateFlightState(flight.config.id, state);
            return of(undefined);
          }

          // icao24 didn't match – search by callsign as fallback
          return this.openSky.findByCallsign(flight.config.icaoCallsign).pipe(
            map(found => {
              this.updateFlightState(flight.config.id, found);
            })
          );
        }),
        catchError(() => {
          this.updateFlightStatus(flight.config.id, 'no-data');
          return of(undefined);
        })
      );
    }

    // No cached icao24 – search by callsign
    return this.openSky.findByCallsign(flight.config.icaoCallsign).pipe(
      map(state => {
        this.updateFlightState(flight.config.id, state);
      }),
      catchError(() => {
        this.updateFlightStatus(flight.config.id, 'no-data');
        return of(undefined);
      })
    );
  }

  private updateFlightState(flightId: string, state: FlightState | null): void {
    this.trackedFlights.update(flights =>
      flights.map(f => {
        if (f.config.id !== flightId) return f;

        const now = Date.now();

        if (!state) {
          // No data received
          const timeSinceLastUpdate = f.lastUpdateTime ? now - f.lastUpdateTime : null;
          let status: FlightStatus = 'no-data';

          if (f.path.length > 0 && timeSinceLastUpdate && timeSinceLastUpdate > DATA_GAP_THRESHOLD) {
            status = 'over-ocean';
          } else if (f.path.length === 0) {
            status = 'planned';
          }

          return { ...f, status };
        }

        // Cache the icao24 address for faster subsequent lookups
        const icao24Cache = state.icao24;

        // Determine status
        let status: FlightStatus;
        if (state.onGround) {
          // Check if it has been in the air before (has path points)
          status = f.path.length > 0 ? 'landed' : 'planned';
        } else {
          status = 'in-air';
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
        };

        const path = [...f.path, newPoint];
        this.savePath(flightId, path);

        return {
          ...f,
          state,
          path,
          status,
          lastUpdateTime: now,
          icao24Cache
        };
      })
    );
  }

  private updateFlightStatus(flightId: string, status: FlightStatus): void {
    this.trackedFlights.update(flights =>
      flights.map(f => f.config.id === flightId ? { ...f, status } : f)
    );
  }

  /**
   * Get estimated position for a flight with data gap.
   * Uses last known position + heading + speed to extrapolate,
   * or great circle interpolation as fallback.
   */
  getEstimatedPosition(flight: TrackedFlight): [number, number] | null {
    if (!flight.lastUpdateTime || flight.path.length === 0) return null;

    const lastPoint = flight.path[flight.path.length - 1];
    const elapsed = (Date.now() - flight.lastUpdateTime) / 1000; // seconds

    if (lastPoint.heading !== null && lastPoint.speed !== null && lastPoint.speed > 0) {
      return this.greatCircle.estimatePosition(
        lastPoint.lat,
        lastPoint.lon,
        lastPoint.heading,
        lastPoint.speed,
        elapsed
      );
    }

    // Fallback: great circle interpolation from last position to destination
    const totalDist = this.greatCircle.distanceKm(
      flight.config.fromCoords,
      flight.config.toCoords
    );
    const distFromStart = this.greatCircle.distanceKm(
      flight.config.fromCoords,
      [lastPoint.lat, lastPoint.lon]
    );
    const avgSpeedKmH = 850; // average cruising speed
    const additionalDist = (elapsed / 3600) * avgSpeedKmH;
    const fraction = (distFromStart + additionalDist) / totalDist;

    return this.greatCircle.interpolatePosition(
      flight.config.fromCoords,
      flight.config.toCoords,
      fraction
    );
  }

  getTimeSinceLastUpdate(flight: TrackedFlight): string {
    if (!flight.lastUpdateTime) return 'Keine Daten';
    const elapsed = Math.floor((Date.now() - flight.lastUpdateTime) / 1000);

    if (elapsed < 60) return `vor ${elapsed}s`;
    if (elapsed < 3600) return `vor ${Math.floor(elapsed / 60)} Min.`;
    return `vor ${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)} Min.`;
  }

  clearPathHistory(): void {
    FLIGHTS.forEach(f => localStorage.removeItem(STORAGE_PREFIX + f.id));
    this.trackedFlights.update(flights =>
      flights.map(f => ({ ...f, path: [], state: null, status: 'planned' as FlightStatus, lastUpdateTime: null, icao24Cache: null }))
    );
  }

  private createTrackedFlight(config: FlightConfig): TrackedFlight {
    return {
      config,
      state: null,
      path: [],
      status: 'planned',
      lastUpdateTime: null,
      icao24Cache: null
    };
  }

  private savePath(flightId: string, path: FlightPathPoint[]): void {
    try {
      localStorage.setItem(STORAGE_PREFIX + flightId, JSON.stringify(path));
    } catch {
      // localStorage full – silently ignore
    }
  }

  private loadPaths(): void {
    this.trackedFlights.update(flights =>
      flights.map(f => {
        try {
          const stored = localStorage.getItem(STORAGE_PREFIX + f.config.id);
          if (stored) {
            const path = JSON.parse(stored) as FlightPathPoint[];
            return {
              ...f,
              path,
              lastUpdateTime: path.length > 0 ? path[path.length - 1].timestamp : null
            };
          }
        } catch {
          // ignore parse errors
        }
        return f;
      })
    );
  }
}
