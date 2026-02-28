import { Component, inject, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { MapComponent } from './components/map/map.component';
import { FlightSelectorComponent } from './components/flight-selector/flight-selector.component';
import { InfoPanelComponent } from './components/info-panel/info-panel.component';
import { FlightTrackingService } from './services/flight-tracking.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MapComponent, FlightSelectorComponent, InfoPanelComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App implements OnInit, OnDestroy {
  protected readonly tracking = inject(FlightTrackingService);

  ngOnInit(): void {
    this.tracking.startTracking();
  }

  ngOnDestroy(): void {
    this.tracking.stopTracking();
  }

  toggleTracking(): void {
    if (this.tracking.isTracking()) {
      this.tracking.stopTracking();
    } else {
      this.tracking.startTracking();
    }
  }

  clearHistory(): void {
    if (confirm('Verlaufsdaten löschen? Alle gespeicherten Flugrouten werden entfernt.')) {
      this.tracking.clearPathHistory();
    }
  }
}
