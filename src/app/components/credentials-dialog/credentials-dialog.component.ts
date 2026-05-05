import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject, signal } from '@angular/core'
import { OpenSkyService } from '../../services/opensky.service'

@Component({
	selector: 'app-credentials-dialog',
	standalone: true,
	imports: [],
	templateUrl: './credentials-dialog.component.html',
	styleUrl: './credentials-dialog.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class CredentialsDialogComponent {
	@Output() closed = new EventEmitter<void>()

	protected readonly openSky = inject(OpenSkyService)
	protected workerUrl = signal(this.openSky.workerUrl())

	protected save (): void {
		const url = this.workerUrl().trim()
		if (!url) return
		this.openSky.saveSettings(url)
		this.closed.emit()
	}

	protected remove (): void {
		this.openSky.clearSettings()
		this.workerUrl.set('')
		this.closed.emit()
	}

	protected cancel (): void {
		this.closed.emit()
	}
}
