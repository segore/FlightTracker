import { Component, inject, effect, OnInit, OnDestroy, signal, ChangeDetectionStrategy } from '@angular/core';
import { LeafletModule } from '@bluehalo/ngx-leaflet';
import * as L from 'leaflet';
import { FlightTrackingService } from '../../services/flight-tracking.service';
import { GreatCircleService } from '../../services/great-circle.service';
import { TrackedFlight } from '../../models/flight.model';
import { AIRPORT_INFO } from '../../config/flights.config';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [LeafletModule],
  templateUrl: './map.component.html',
  styleUrl: './map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MapComponent implements OnInit, OnDestroy {
  private readonly tracking = inject(FlightTrackingService);
  private readonly greatCircle = inject(GreatCircleService);

  private map!: L.Map;
  private planeMarkers = new Map<string, L.Marker>();
  private pathLines = new Map<string, L.Polyline>();
  private routeLines = new Map<string, L.Polyline>();
  private estimatedLines = new Map<string, L.Polyline>();
  private estimatedMarkers = new Map<string, L.Marker>();
  private airportMarkers: L.Marker[] = [];
  private updateInterval: any;

  options: L.MapOptions = {
    layers: [
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18
      })
    ],
    zoom: 5,
    center: L.latLng(30, 60), // Centered between Europe and SE Asia
    zoomControl: true
  };

  ngOnInit(): void {
    // Periodically update estimated positions
    this.updateInterval = setInterval(() => this.updateEstimatedPositions(), 5000);
  }

  ngOnDestroy(): void {
    if (this.updateInterval) clearInterval(this.updateInterval);
  }

  onMapReady(map: L.Map): void {
    this.map = map;

    // Fix leaflet icon paths (common issue with bundlers)
    this.fixLeafletIcons();

    // Add airport markers
    this.addAirportMarkers();

    // Draw planned routes
    this.drawPlannedRoutes();

    // Initial render of flight data
    this.renderFlights();

    // Set up a watcher for flight data changes using polling
    // (Signals in Angular don't use effect() in components for map side-effects easily)
    setInterval(() => this.renderFlights(), 2000);

    // Fit bounds to show all routes
    this.fitToAllRoutes();
  }

  fitToSelected(): void {
    const flight = this.tracking.selectedFlight();
    if (!flight) return;

    const bounds = L.latLngBounds([
      L.latLng(flight.config.fromCoords[0], flight.config.fromCoords[1]),
      L.latLng(flight.config.toCoords[0], flight.config.toCoords[1])
    ]);

    if (flight.state) {
      bounds.extend(L.latLng(flight.state.lat, flight.state.lon));
    }

    this.map.fitBounds(bounds, { padding: [50, 50] });
  }

  fitToAllRoutes(): void {
    if (!this.map) return;
    const flights = this.tracking.trackedFlights();
    const allCoords: L.LatLng[] = [];

    flights.forEach(f => {
      allCoords.push(L.latLng(f.config.fromCoords[0], f.config.fromCoords[1]));
      allCoords.push(L.latLng(f.config.toCoords[0], f.config.toCoords[1]));
    });

    if (allCoords.length > 0) {
      this.map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50] });
    }
  }

  private fixLeafletIcons(): void {
    const iconDefault = L.icon({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      tooltipAnchor: [16, -28],
      shadowSize: [41, 41]
    });
    L.Marker.prototype.options.icon = iconDefault;
  }

  private addAirportMarkers(): void {
    Object.entries(AIRPORT_INFO).forEach(([code, info]) => {
      const marker = L.marker(L.latLng(info.coords[0], info.coords[1]), {
        icon: L.divIcon({
          className: 'airport-icon',
          html: `<div class="airport-marker">
                   <span class="airport-dot"></span>
                   <span class="airport-label">${code}</span>
                 </div>`,
          iconSize: [60, 24],
          iconAnchor: [10, 12]
        })
      }).addTo(this.map);

      marker.bindPopup(`<b>${info.name}</b><br>${info.city}`);
      this.airportMarkers.push(marker);
    });
  }

  private drawPlannedRoutes(): void {
    const flights = this.tracking.trackedFlights();

    flights.forEach(flight => {
      const routePoints = this.greatCircle.calculateRoute(
        flight.config.fromCoords,
        flight.config.toCoords,
        100
      );

      const latLngs = routePoints.map(p => L.latLng(p[0], p[1]));
      const routeLine = L.polyline(latLngs, {
        color: flight.config.color,
        weight: 2,
        opacity: 0.3,
        dashArray: '10, 8'
      }).addTo(this.map);

      this.routeLines.set(flight.config.id, routeLine);
    });
  }

  private renderFlights(): void {
    const flights = this.tracking.trackedFlights();

    flights.forEach(flight => {
      this.renderFlightPath(flight);
      this.renderPlaneMarker(flight);
    });
  }

  private renderFlightPath(flight: TrackedFlight): void {
    const realPoints = flight.path
      .filter(p => !p.estimated)
      .map(p => L.latLng(p.lat, p.lon));

    if (realPoints.length > 0) {
      if (this.pathLines.has(flight.config.id)) {
        this.pathLines.get(flight.config.id)!.setLatLngs(realPoints);
      } else {
        const line = L.polyline(realPoints, {
          color: flight.config.color,
          weight: 3,
          opacity: 0.8
        }).addTo(this.map);
        this.pathLines.set(flight.config.id, line);
      }
    }
  }

  private renderPlaneMarker(flight: TrackedFlight): void {
    if (flight.state && !flight.state.onGround) {
      const heading = flight.state.trueTrack ?? 0;
      const icon = this.createPlaneIcon(flight.config.color, heading);
      const pos = L.latLng(flight.state.lat, flight.state.lon);

      if (this.planeMarkers.has(flight.config.id)) {
        const marker = this.planeMarkers.get(flight.config.id)!;
        marker.setLatLng(pos);
        marker.setIcon(icon);
      } else {
        const marker = L.marker(pos, { icon, zIndexOffset: 1000 }).addTo(this.map);
        marker.bindTooltip(this.getFlightTooltip(flight), {
          permanent: false,
          direction: 'top',
          offset: [0, -15]
        });
        this.planeMarkers.set(flight.config.id, marker);
      }

      // Update tooltip
      const marker = this.planeMarkers.get(flight.config.id)!;
      marker.setTooltipContent(this.getFlightTooltip(flight));

      // Remove estimated marker if live data is available
      this.removeEstimated(flight.config.id);
    } else if (flight.status === 'over-ocean' || (flight.status === 'no-data' && flight.path.length > 0)) {
      // Show estimated position
      this.renderEstimatedPosition(flight);
      // Remove live marker
      this.removePlaneMarker(flight.config.id);
    } else if (flight.status === 'landed') {
      // Show landed marker at last known position
      if (flight.path.length > 0) {
        const lastPoint = flight.path[flight.path.length - 1];
        const pos = L.latLng(lastPoint.lat, lastPoint.lon);
        const icon = this.createLandedIcon(flight.config.color);

        if (this.planeMarkers.has(flight.config.id)) {
          const marker = this.planeMarkers.get(flight.config.id)!;
          marker.setLatLng(pos);
          marker.setIcon(icon);
        } else {
          const marker = L.marker(pos, { icon }).addTo(this.map);
          this.planeMarkers.set(flight.config.id, marker);
        }
      }
    }
  }

  private renderEstimatedPosition(flight: TrackedFlight): void {
    const estimated = this.tracking.getEstimatedPosition(flight);
    if (!estimated) return;

    const pos = L.latLng(estimated[0], estimated[1]);
    const icon = this.createEstimatedPlaneIcon(flight.config.color);
    const timeSince = this.tracking.getTimeSinceLastUpdate(flight);

    if (this.estimatedMarkers.has(flight.config.id)) {
      const marker = this.estimatedMarkers.get(flight.config.id)!;
      marker.setLatLng(pos);
    } else {
      const marker = L.marker(pos, { icon, zIndexOffset: 900, opacity: 0.7 }).addTo(this.map);
      marker.bindTooltip(`${flight.config.iata} (geschätzt)<br>Letzte Daten: ${timeSince}`, {
        permanent: false,
        direction: 'top'
      });
      this.estimatedMarkers.set(flight.config.id, marker);
    }

    // Draw estimated path from last known to estimated position
    if (flight.path.length > 0) {
      const lastPoint = flight.path[flight.path.length - 1];
      const estLine = L.polyline(
        [L.latLng(lastPoint.lat, lastPoint.lon), pos],
        {
          color: flight.config.color,
          weight: 2,
          opacity: 0.4,
          dashArray: '6, 6'
        }
      );

      if (this.estimatedLines.has(flight.config.id)) {
        this.estimatedLines.get(flight.config.id)!.remove();
      }
      estLine.addTo(this.map);
      this.estimatedLines.set(flight.config.id, estLine);
    }
  }

  private updateEstimatedPositions(): void {
    const flights = this.tracking.trackedFlights();
    flights.forEach(flight => {
      if (flight.status === 'over-ocean' || (flight.status === 'no-data' && flight.path.length > 0)) {
        this.renderEstimatedPosition(flight);
      }
    });
  }

  private removePlaneMarker(id: string): void {
    if (this.planeMarkers.has(id)) {
      this.planeMarkers.get(id)!.remove();
      this.planeMarkers.delete(id);
    }
  }

  private removeEstimated(id: string): void {
    if (this.estimatedMarkers.has(id)) {
      this.estimatedMarkers.get(id)!.remove();
      this.estimatedMarkers.delete(id);
    }
    if (this.estimatedLines.has(id)) {
      this.estimatedLines.get(id)!.remove();
      this.estimatedLines.delete(id);
    }
  }

  private createPlaneIcon(color: string, heading: number): L.DivIcon {
    return L.divIcon({
      className: 'plane-icon',
      html: `<div class="plane-marker" style="transform: rotate(${heading}deg)">
               <svg width="32" height="32" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg">
                 <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
               </svg>
             </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }

  private createEstimatedPlaneIcon(color: string): L.DivIcon {
    return L.divIcon({
      className: 'plane-icon estimated',
      html: `<div class="plane-marker estimated-marker">
               <svg width="32" height="32" viewBox="0 0 24 24" fill="${color}" opacity="0.5" xmlns="http://www.w3.org/2000/svg">
                 <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
               </svg>
               <span class="estimated-badge">?</span>
             </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }

  private createLandedIcon(color: string): L.DivIcon {
    return L.divIcon({
      className: 'plane-icon landed',
      html: `<div class="plane-marker landed-marker">
               <span style="font-size: 20px; color: ${color};">✅</span>
             </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  private getFlightTooltip(flight: TrackedFlight): string {
    if (!flight.state) return flight.config.iata;

    const alt = flight.state.baroAltitude
      ? `${Math.round(flight.state.baroAltitude)}m (${Math.round(flight.state.baroAltitude * 3.281)}ft)`
      : 'N/A';
    const speed = flight.state.velocity
      ? `${Math.round(flight.state.velocity * 3.6)} km/h`
      : 'N/A';

    return `<b>${flight.config.iata}</b> (${flight.config.airline})<br>` +
      `${flight.config.from} → ${flight.config.to}<br>` +
      `Höhe: ${alt}<br>` +
      `Speed: ${speed}`;
  }
}
