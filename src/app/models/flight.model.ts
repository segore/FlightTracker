export interface FlightConfig {
  id: string
  iata: string
  icaoCallsign: string
  airline: string
  from: string
  to: string
  fromCoords: [number, number] // [lat, lon]
  toCoords: [number, number]
  color: string
}

export interface FlightState {
  icao24: string
  callsign: string
  originCountry: string
  lat: number
  lon: number
  baroAltitude: number | null
  geoAltitude: number | null
  onGround: boolean
  velocity: number | null // m/s
  trueTrack: number | null // degrees
  verticalRate: number | null // m/s
  lastContact: number // unix timestamp
  timePosition: number | null
}

export interface FlightPathPoint {
  timestamp: number
  lat: number
  lon: number
  altitude: number | null
  speed: number | null
  heading: number | null
  estimated: boolean
}

export type FlightStatus = 'planned' | 'in-air' | 'landed' | 'no-data' | 'over-ocean'

export type TrackingMode = 'live' | 'manual' | 'off'

export interface TrackedFlight {
  config: FlightConfig
  state: FlightState | null
  path: FlightPathPoint[]
  status: FlightStatus
  lastUpdateTime: number | null
  icao24Cache: string | null
}

export interface OpenSkyResponse {
  time: number
  states: any[][] | null
}
