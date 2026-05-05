import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { Injectable, computed, inject, signal } from '@angular/core'
import { Observable, catchError, map, of } from 'rxjs'
import { FlightState, OpenSkyResponse } from '../models/flight.model'

const SETTINGS_KEY = 'ft_opensky_settings'

interface OpenSkySettings {
  workerUrl: string        // e.g. https://my-worker.my-name.workers.dev
}

@Injectable({ providedIn: 'root' })
export class OpenSkyService {
  private readonly http = inject(HttpClient);

  /** Track rate limit state */
  private rateLimitedUntil = 0;

  private readonly settings = signal<OpenSkySettings | null>(this.loadSettings());

  readonly hasWorker = computed(() => !!this.settings()?.workerUrl);
  readonly workerUrl = computed(() => this.settings()?.workerUrl ?? '');

  get isRateLimited (): boolean {
    return Date.now() < this.rateLimitedUntil
  }

  get rateLimitRemainingSeconds (): number {
    return Math.max(0, Math.ceil((this.rateLimitedUntil - Date.now()) / 1000))
  }

  saveSettings (workerUrl: string): void {
    const s: OpenSkySettings = { workerUrl: workerUrl.trim().replace(/\/$/, '') }
    this.settings.set(s)
    try
    {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
    } catch { /* ignore */ }
  }

  clearSettings (): void {
    this.settings.set(null)
    localStorage.removeItem(SETTINGS_KEY)
  }

  private loadSettings (): OpenSkySettings | null {
    try
    {
      const stored = localStorage.getItem(SETTINGS_KEY)
      return stored ? JSON.parse(stored) : null
    } catch
    {
      return null
    }
  }

  /**
   * Build a URL targeting the Cloudflare Worker proxy.
   * OAuth2 is handled inside the Worker via Cloudflare Secrets.
   */
  private buildUrl (path: string, extraParams: [string, string][] = []): string {
    const s = this.settings()
    if (!s?.workerUrl) throw new Error('Kein Cloudflare Worker konfiguriert.')
    const url = new URL(`${s.workerUrl}/proxy${path}`)
    for (const [k, v] of extraParams) url.searchParams.append(k, v)
    return url.toString()
  }

  /**
   * Search for flights by callsign within a geographic bounding box.
   */
  findFlightsInArea (
    callsigns: string[],
    bounds: { lamin: number; lamax: number; lomin: number; lomax: number }
  ): Observable<Map<string, FlightState>> {
    if (this.isRateLimited)
    {
      console.warn(`OpenSky rate limited – waiting ${this.rateLimitRemainingSeconds}s`)
      return of(new Map())
    }

    let url: string
    try
    {
      url = this.buildUrl('/states/all', [
        ['lamin', String(bounds.lamin)],
        ['lamax', String(bounds.lamax)],
        ['lomin', String(bounds.lomin)],
        ['lomax', String(bounds.lomax)],
      ])
    } catch (e: any)
    {
      console.error(e.message)
      return of(new Map())
    }

    const targets = callsigns.map(c => c.toUpperCase().replace(/\s/g, ''))
    console.log(`OpenSky: Bereich lat ${bounds.lamin.toFixed(1)}–${bounds.lamax.toFixed(1)}, lon ${bounds.lomin.toFixed(1)}–${bounds.lomax.toFixed(1)} (via Worker)`)

    return this.http.get<OpenSkyResponse>(url).pipe(
      map(res => {
        const states = this.parseStates(res)
        console.log(`OpenSky: ${states.length} Flugzeuge im Suchbereich`)

        const result = new Map<string, FlightState>()
        const similarCallsigns: string[] = []

        for (const state of states)
        {
          const cs = state.callsign.toUpperCase().replace(/\s/g, '')
          if (targets.includes(cs)) result.set(cs, state)
          for (const target of targets)
          {
            if (cs && cs.startsWith(target.substring(0, 3)) && !targets.includes(cs))
            {
              similarCallsigns.push(cs)
            }
          }
        }

        if (similarCallsigns.length > 0)
        {
          const unique = [...new Set(similarCallsigns)].sort().slice(0, 20)
          console.log(`OpenSky: Ähnliche Callsigns: ${unique.join(', ')}`)
        }
        console.log(
          `OpenSky: ${result.size}/${targets.length} gefunden: ` +
          targets.map(t => result.has(t) ? `✓ ${t}` : `✗ ${t}`).join(', ')
        )
        return result
      }),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 429)
        {
          this.rateLimitedUntil = Date.now() + 180_000
          console.warn('OpenSky 429 – backing off for 180s')
        } else
        {
          console.error(`OpenSky Fehler: ${err.status} ${err.statusText}`)
        }
        return of(new Map<string, FlightState>())
      })
    )
  }

  /**
   * Get states filtered by icao24 address(es) – most efficient targeted request.
   */
  getStatesByIcao24 (icao24s: string[]): Observable<FlightState[]> {
    if (this.isRateLimited || icao24s.length === 0) return of([])

    let url: string
    try
    {
      url = this.buildUrl('/states/all', icao24s.map(id => ['icao24', id]))
    } catch (e: any)
    {
      console.error(e.message)
      return of([])
    }

    console.log(`OpenSky: ICAO24-Abfrage für ${icao24s.join(', ')}`)

    return this.http.get<OpenSkyResponse>(url).pipe(
      map(res => {
        const states = this.parseStates(res)
        console.log(`OpenSky: ${states.length} Ergebnis(se) für ICAO24-Abfrage`)
        return states
      }),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 429)
        {
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

