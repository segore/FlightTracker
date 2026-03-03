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
   * Search for flights by callsign within a geographic bounding box.
   * Uses server-side geographic filtering → returns only a few hundred aircraft
   * instead of ~10,000+ globally. Then filters by callsign client-side.
   */
  findFlightsInArea (
    callsigns: string[],
    bounds: { lamin: number; lamax: number; lomin: number; lomax: number }
  ): Observable<Map<string, FlightState>> {
    if (this.isRateLimited) {
      console.warn(`OpenSky rate limited – waiting ${this.rateLimitRemainingSeconds}s`)
      return of(new Map())
    }

    const targets = callsigns.map(c => c.toUpperCase().replace(/\s/g, ''))
    const url = `${OPENSKY_BASE}/states/all?lamin=${bounds.lamin}&lamax=${bounds.lamax}&lomin=${bounds.lomin}&lomax=${bounds.lomax}`

    console.log(`OpenSky: Frage Bereich ab lat ${bounds.lamin.toFixed(1)}–${bounds.lamax.toFixed(1)}, lon ${bounds.lomin.toFixed(1)}–${bounds.lomax.toFixed(1)}`)

    return this.http.get<OpenSkyResponse>(url).pipe(
      map(res => {
        const states = this.parseStates(res)
        console.log(`OpenSky: ${states.length} Flugzeuge im Suchbereich (statt ~10.000+ global)`)

        const result = new Map<string, FlightState>()
        const similarCallsigns: string[] = []

        for (const state of states) {
          const cs = state.callsign.toUpperCase().replace(/\s/g, '')
          if (targets.includes(cs)) {
            result.set(cs, state)
          }
          // Collect callsigns from same airline for diagnostics
          for (const target of targets) {
            if (cs && cs.startsWith(target.substring(0, 3)) && !targets.includes(cs)) {
              similarCallsigns.push(cs)
            }
          }
        }

        if (similarCallsigns.length > 0) {
          const unique = [...new Set(similarCallsigns)].sort().slice(0, 20)
          console.log(`OpenSky: Ähnliche Callsigns (gleiche Airline): ${unique.join(', ')}`)
        }

        console.log(
          `OpenSky: ${result.size}/${targets.length} Flüge gefunden: ` +
          targets.map(t => result.has(t) ? `✓ ${t}` : `✗ ${t}`).join(', ')
        )

        return result
      }),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 429) {
          this.rateLimitedUntil = Date.now() + 180_000
          console.warn('OpenSky 429 – backing off for 180s')
        } else {
          console.error(`OpenSky Fehler: ${err.status} ${err.statusText}`)
        }
        return of(new Map<string, FlightState>())
      })
    )
  }

  /**
   * Get states filtered by icao24 address(es) – efficient targeted request.
   * Returns only the exact aircraft we're looking for → ~1-3 results.
   */
  getStatesByIcao24 (icao24s: string[]): Observable<FlightState[]> {
    if (this.isRateLimited || icao24s.length === 0) {
      return of([])
    }

    const url = `${OPENSKY_BASE}/states/all`
    // OpenSky supports multiple icao24 params
    const paramStr = icao24s.map(id => `icao24=${id}`).join('&')

    console.log(`OpenSky: Gezielte ICAO24-Abfrage für ${icao24s.join(', ')}`)

    return this.http.get<OpenSkyResponse>(`${url}?${paramStr}`).pipe(
      map(res => {
        const states = this.parseStates(res)
        console.log(`OpenSky: ${states.length} Ergebnis(se) für ICAO24-Abfrage`)
        return states
      }),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 429) {
          this.rateLimitedUntil = Date.now() + 180_000
          console.warn('OpenSky 429 – backing off for 180s')
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
