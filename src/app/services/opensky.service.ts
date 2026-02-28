import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, map, catchError } from 'rxjs';
import { FlightState, OpenSkyResponse } from '../models/flight.model';

const OPENSKY_BASE = 'https://opensky-network.org/api';

@Injectable({ providedIn: 'root' })
export class OpenSkyService {
  private readonly http = inject(HttpClient);

  /**
   * Get all flight states, optionally filtered by icao24 address(es).
   */
  getStates(icao24?: string | string[]): Observable<FlightState[]> {
    let url = `${OPENSKY_BASE}/states/all`;
    const params: Record<string, string> = {};

    if (icao24) {
      if (Array.isArray(icao24)) {
        // Multiple icao24 addresses – use multiple params
        const paramStr = icao24.map(id => `icao24=${id}`).join('&');
        url = `${url}?${paramStr}`;
        return this.http.get<OpenSkyResponse>(url).pipe(
          map(res => this.parseStates(res)),
          catchError(() => of([]))
        );
      } else {
        params['icao24'] = icao24;
      }
    }

    return this.http.get<OpenSkyResponse>(url, { params }).pipe(
      map(res => this.parseStates(res)),
      catchError(() => of([]))
    );
  }

  /**
   * Search for a flight by ICAO callsign (e.g., "DLH2007").
   * Since OpenSky doesn't support callsign filtering in query params,
   * we fetch all states and filter client-side.
   * Uses bounding box if provided to reduce data.
   */
  findByCallsign(callsign: string, boundingBox?: { lamin: number; lomin: number; lamax: number; lomax: number }): Observable<FlightState | null> {
    let url = `${OPENSKY_BASE}/states/all`;
    const params: Record<string, string> = {};

    if (boundingBox) {
      params['lamin'] = boundingBox.lamin.toString();
      params['lomin'] = boundingBox.lomin.toString();
      params['lamax'] = boundingBox.lamax.toString();
      params['lomax'] = boundingBox.lomax.toString();
    }

    return this.http.get<OpenSkyResponse>(url, { params }).pipe(
      map(res => {
        const states = this.parseStates(res);
        const target = callsign.toUpperCase().trim();
        return states.find(s => s.callsign.toUpperCase().trim() === target) ?? null;
      }),
      catchError(() => of(null))
    );
  }

  private parseStates(response: OpenSkyResponse): FlightState[] {
    if (!response.states) return [];

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
    }));
  }
}
