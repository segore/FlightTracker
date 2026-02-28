import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FlightTrackingService } from '../../services/flight-tracking.service';
import { GreatCircleService } from '../../services/great-circle.service';
import { TrackedFlight } from '../../models/flight.model';

@Component({
  selector: 'app-info-panel',
  standalone: true,
  imports: [],
  templateUrl: './info-panel.component.html',
  styleUrl: './info-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InfoPanelComponent {
  protected readonly tracking = inject(FlightTrackingService);
  private readonly greatCircle = inject(GreatCircleService);

  get flight(): TrackedFlight | null {
    return this.tracking.selectedFlight();
  }

  get altitudeMeters(): string {
    const alt = this.flight?.state?.baroAltitude;
    if (alt == null) return '—';
    return `${Math.round(alt).toLocaleString('de-DE')} m`;
  }

  get altitudeFeet(): string {
    const alt = this.flight?.state?.baroAltitude;
    if (alt == null) return '—';
    return `${Math.round(alt * 3.281).toLocaleString('de-DE')} ft`;
  }

  get speedKmh(): string {
    const vel = this.flight?.state?.velocity;
    if (vel == null) return '—';
    return `${Math.round(vel * 3.6).toLocaleString('de-DE')} km/h`;
  }

  get heading(): string {
    const track = this.flight?.state?.trueTrack;
    if (track == null) return '—';
    return `${Math.round(track)}°`;
  }

  get verticalRate(): string {
    const vr = this.flight?.state?.verticalRate;
    if (vr == null) return '—';
    const fpm = Math.round(vr * 196.85); // m/s to ft/min
    return `${fpm > 0 ? '+' : ''}${fpm.toLocaleString('de-DE')} ft/min`;
  }

  get verticalRateDirection(): 'up' | 'down' | 'level' {
    const vr = this.flight?.state?.verticalRate;
    if (vr == null || Math.abs(vr) < 0.5) return 'level';
    return vr > 0 ? 'up' : 'down';
  }

  get lastUpdate(): string {
    if (!this.flight) return '—';
    return this.tracking.getTimeSinceLastUpdate(this.flight);
  }

  get totalDistance(): string {
    if (!this.flight) return '—';
    const dist = this.greatCircle.distanceKm(
      this.flight.config.fromCoords,
      this.flight.config.toCoords
    );
    return `${Math.round(dist).toLocaleString('de-DE')} km`;
  }

  get distanceTraveled(): string {
    if (!this.flight?.state) return '—';
    const dist = this.greatCircle.distanceKm(
      this.flight.config.fromCoords,
      [this.flight.state.lat, this.flight.state.lon]
    );
    return `${Math.round(dist).toLocaleString('de-DE')} km`;
  }

  get progressPercent(): number {
    if (!this.flight?.state) return 0;
    const total = this.greatCircle.distanceKm(
      this.flight.config.fromCoords,
      this.flight.config.toCoords
    );
    const traveled = this.greatCircle.distanceKm(
      this.flight.config.fromCoords,
      [this.flight.state.lat, this.flight.state.lon]
    );
    return Math.min(100, Math.round((traveled / total) * 100));
  }

  get coordinates(): string {
    if (!this.flight?.state) return '—';
    const lat = this.flight.state.lat.toFixed(4);
    const lon = this.flight.state.lon.toFixed(4);
    return `${lat}°, ${lon}°`;
  }
}
