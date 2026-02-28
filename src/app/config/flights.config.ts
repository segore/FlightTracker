import { FlightConfig } from '../models/flight.model';

export const FLIGHTS: FlightConfig[] = [
  {
    id: 'lh2007',
    iata: 'LH 2007',
    icaoCallsign: 'DLH2007',
    airline: 'Lufthansa',
    from: 'DUS',
    to: 'MUC',
    fromCoords: [51.2895, 6.7668],   // Düsseldorf
    toCoords: [48.3538, 11.7861],    // München
    color: '#0f4c81'
  },
  {
    id: 'sq327',
    iata: 'SQ 327',
    icaoCallsign: 'SIA327',
    airline: 'Singapore Airlines',
    from: 'MUC',
    to: 'SIN',
    fromCoords: [48.3538, 11.7861],  // München
    toCoords: [1.3644, 103.9915],    // Singapore Changi
    color: '#f59e0b'
  },
  {
    id: 'sq922',
    iata: 'SQ 922',
    icaoCallsign: 'SIA922',
    airline: 'Singapore Airlines',
    from: 'SIN',
    to: 'SUB',
    fromCoords: [1.3644, 103.9915],  // Singapore Changi
    toCoords: [-7.3798, 112.7876],   // Surabaya Juanda
    color: '#10b981'
  }
];

export const AIRPORT_INFO: Record<string, { name: string; city: string; coords: [number, number] }> = {
  DUS: { name: 'Düsseldorf Airport', city: 'Düsseldorf', coords: [51.2895, 6.7668] },
  MUC: { name: 'Franz Josef Strauß', city: 'München', coords: [48.3538, 11.7861] },
  SIN: { name: 'Changi Airport', city: 'Singapur', coords: [1.3644, 103.9915] },
  SUB: { name: 'Juanda International', city: 'Surabaya', coords: [-7.3798, 112.7876] }
};

/**
 * Mapping IATA airline codes → ICAO callsign prefixes.
 * Used for searching flights by IATA number in the OpenSky API.
 */
export const IATA_TO_ICAO_AIRLINE: Record<string, string> = {
  'LH': 'DLH',  // Lufthansa
  'SQ': 'SIA',  // Singapore Airlines
  'BA': 'BAW',  // British Airways
  'AF': 'AFR',  // Air France
  'KL': 'KLM',  // KLM
  'UA': 'UAL',  // United Airlines
  'AA': 'AAL',  // American Airlines
  'DL': 'DAL',  // Delta
  'EK': 'UAE',  // Emirates
  'QF': 'QFA',  // Qantas
  'TK': 'THY',  // Turkish Airlines
  'EW': 'EWG',  // Eurowings
  'QR': 'QTR',  // Qatar Airways
  'GA': 'GIA',  // Garuda Indonesia
  'JT': 'LNI',  // Lion Air
  'ID': 'BTK',  // Batik Air
};
