import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { FlightSelectorComponent } from './components/flight-selector/flight-selector.component'
import { InfoPanelComponent } from './components/info-panel/info-panel.component'
import { MapComponent } from './components/map/map.component'
import { TrackingMode } from './models/flight.model'
import { FlightTrackingService } from './services/flight-tracking.service'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MapComponent, FlightSelectorComponent, InfoPanelComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {
  protected readonly tracking = inject(FlightTrackingService);

  setMode (mode: TrackingMode): void {
    this.tracking.setMode(mode)
  }

  manualPoll (): void {
    this.tracking.pollOnce()
  }

  clearHistory (): void {
    if (confirm('Verlaufsdaten löschen? Alle gespeicherten Flugrouten werden entfernt.')) {
      this.tracking.clearPathHistory()
    }
  }
}
