import { Injectable } from '@angular/core';

/**
 * Service to calculate Great Circle routes between two coordinates.
 * Uses the Haversine formula and intermediate point calculations.
 */
@Injectable({ providedIn: 'root' })
export class GreatCircleService {

  /**
   * Calculate intermediate points along a great circle route.
   * @param from [lat, lon] in degrees
   * @param to [lat, lon] in degrees
   * @param numPoints Number of intermediate points (default 100)
   * @returns Array of [lat, lon] pairs
   */
  calculateRoute(from: [number, number], to: [number, number], numPoints = 100): [number, number][] {
    const points: [number, number][] = [];
    const lat1 = this.toRad(from[0]);
    const lon1 = this.toRad(from[1]);
    const lat2 = this.toRad(to[0]);
    const lon2 = this.toRad(to[1]);

    const d = this.angularDistance(lat1, lon1, lat2, lon2);

    for (let i = 0; i <= numPoints; i++) {
      const f = i / numPoints;
      const A = Math.sin((1 - f) * d) / Math.sin(d);
      const B = Math.sin(f * d) / Math.sin(d);

      const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
      const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
      const z = A * Math.sin(lat1) + B * Math.sin(lat2);

      const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
      const lon = Math.atan2(y, x);

      points.push([this.toDeg(lat), this.toDeg(lon)]);
    }

    return points;
  }

  /**
   * Calculate the total distance in kilometers between two coordinates.
   */
  distanceKm(from: [number, number], to: [number, number]): number {
    const R = 6371; // Earth radius in km
    const lat1 = this.toRad(from[0]);
    const lon1 = this.toRad(from[1]);
    const lat2 = this.toRad(to[0]);
    const lon2 = this.toRad(to[1]);
    return this.angularDistance(lat1, lon1, lat2, lon2) * R;
  }

  /**
   * Estimate position along a great circle route given elapsed fraction.
   * @param from start coords [lat, lon]
   * @param to end coords [lat, lon]
   * @param fraction 0..1 how far along the route
   */
  interpolatePosition(from: [number, number], to: [number, number], fraction: number): [number, number] {
    const clamped = Math.max(0, Math.min(1, fraction));
    const lat1 = this.toRad(from[0]);
    const lon1 = this.toRad(from[1]);
    const lat2 = this.toRad(to[0]);
    const lon2 = this.toRad(to[1]);

    const d = this.angularDistance(lat1, lon1, lat2, lon2);
    if (d < 1e-10) return from;

    const A = Math.sin((1 - clamped) * d) / Math.sin(d);
    const B = Math.sin(clamped * d) / Math.sin(d);

    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);

    return [
      this.toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
      this.toDeg(Math.atan2(y, x))
    ];
  }

  /**
   * Estimate position based on last known position, heading, and speed.
   */
  estimatePosition(
    lastLat: number,
    lastLon: number,
    headingDeg: number,
    speedMs: number,
    elapsedSeconds: number
  ): [number, number] {
    const R = 6371000; // Earth radius in meters
    const d = speedMs * elapsedSeconds;
    const bearing = this.toRad(headingDeg);

    const lat1 = this.toRad(lastLat);
    const lon1 = this.toRad(lastLon);

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d / R) +
      Math.cos(lat1) * Math.sin(d / R) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(d / R) * Math.cos(lat1),
      Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2)
    );

    return [this.toDeg(lat2), this.toDeg(lon2)];
  }

  private angularDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    return Math.acos(
      Math.sin(lat1) * Math.sin(lat2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
    );
  }

  private toRad(deg: number): number {
    return deg * Math.PI / 180;
  }

  private toDeg(rad: number): number {
    return rad * 180 / Math.PI;
  }
}
