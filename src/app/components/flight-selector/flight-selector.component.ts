import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FlightTrackingService } from '../../services/flight-tracking.service';
import { FlightStatus } from '../../models/flight.model';

@Component({
  selector: 'app-flight-selector',
  standalone: true,
  imports: [],
  templateUrl: './flight-selector.component.html',
  styleUrl: './flight-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FlightSelectorComponent {
  protected readonly tracking = inject(FlightTrackingService);

  selectFlight(id: string): void {
    this.tracking.selectFlight(id);
  }

  getStatusLabel(status: FlightStatus): string {
    switch (status) {
      case 'planned': return 'Geplant';
      case 'in-air': return 'In der Luft';
      case 'landed': return 'Gelandet';
      case 'over-ocean': return 'Über dem Ozean';
      case 'no-data': return 'Keine Daten';
    }
  }

  getStatusIcon(status: FlightStatus): string {
    switch (status) {
      case 'planned': return '📅';
      case 'in-air': return '✈️';
      case 'landed': return '✅';
      case 'over-ocean': return '🌊';
      case 'no-data': return '⚪';
    }
  }

  getStatusClass(status: FlightStatus): string {
    return `status-${status}`;
  }
}
