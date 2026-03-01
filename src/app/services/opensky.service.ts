import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable, catchError, map, of } from 'rxjs'
import { FlightState, OpenSkyResponse } from '../models/flight.model'

const OPENSKY_BASE = 'https://opensky-network.org/api'

@Injectable({ providedIn: 'root' })
export class OpenSkyService {
  private readonly http = inject(HttpClient);

  /** Track rate limit state */
  private rateLimitedUntil = 0;

  get isRateLimited (): boolean {
    return Date.now() < this.rateLimitedUntil
  }

  get rateLimitRemainingSeconds (): number {
    return Math.max(0, Math.ceil((this.rateLimitedUntil - Date.now()) / 1000))
  }

  /**
   * Fetch all states in a single request and filter by callsigns client-side.
   * This is the most efficient approach – ONE request for ALL flights.
   */
  findFlightsByCallsigns (callsigns: string[]): Observable<Map<string, FlightState>> {
    if (this.isRateLimited) {
      console.warn(`OpenSky rate limited – waiting ${this.rateLimitRemainingSeconds}s`)
      return of(new Map())
    }

    const targets = callsigns.map(c => c.toUpperCase().replace(/\s/g, ''))
    const url = `${OPENSKY_BASE}/states/all`

    return this.http.get<OpenSkyResponse>(url).pipe(
      map(res => {
        const states = this.parseStates(res)
        const result = new Map<string, FlightState>()

        for (const state of states) {
          const cs = state.callsign.toUpperCase().replace(/\s/g, '')
          if (targets.includes(cs)) {
            result.set(cs, state)
          }
        }
        return result
      }),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 429) {
          // Rate limited – back off for 60 seconds
          this.rateLimitedUntil = Date.now() + 60_000
          console.warn('OpenSky 429 – backing off for 60s')
        }
        return of(new Map<string, FlightState>())
      })
    )
  }

  /**
   * Get states filtered by icao24 address(es) – efficient targeted request.
   */
  getStatesByIcao24 (icao24s: string[]): Observable<FlightState[]> {
    if (this.isRateLimited || icao24s.length === 0) {
      return of([])
    }

    const url = `${OPENSKY_BASE}/states/all`
    // OpenSky supports multiple icao24 params
    const paramStr = icao24s.map(id => `icao24=${id}`).join('&')

    return this.http.get<OpenSkyResponse>(`${url}?${paramStr}`).pipe(
      map(res => this.parseStates(res)),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 429) {
          this.rateLimitedUntil = Date.now() + 60_000
          console.warn('OpenSky 429 – backing off for 60s')
        }
        return of([])
      })
    )
  }

  private parseStates (response: OpenSkyResponse): FlightState[] {
    if (!response.states) return []

    return response.states.map(s => ({
      icao24: s[0] as string,
      callsign: (s[1] as string || '').trim(),
      originCountry: s[2] as string,
      timePosition: s[3] as number | null,
      lastContact: s[4] as number,
      lon: s[5] as number,
      lat: s[6] as number,
      baroAltitude: s[7] as number | null,
      onGround: s[8] as boolean,
      velocity: s[9] as number | null,
      trueTrack: s[10] as number | null,
      verticalRate: s[11] as number | null,
      geoAltitude: s[13] as number | null,
    }))
  }
}
