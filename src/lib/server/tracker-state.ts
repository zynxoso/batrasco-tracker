/**
 * Shared tracker state logic for Sinotrack-style vehicle data.
 * Used by API and (optionally) local dev. Position is time-based and never loops.
 */

import { computeEtaInDirectionOfTravel, ROUTE_LENGTH_KM } from '../route/route-geometry';

export type VehicleStatus = 'online' | 'offline';

export type TrackerVehicle = {
  id: string;
  plateNumber: string;
  driver: string;
  currentPosition: number; // 0–100, route percentage
  speed: number; // km/h
  status: VehicleStatus;
  passengers: number;
  capacity: number;
  /** Tracker device online (reporting) or offline */
  trackerOnline: boolean;
  /** Remaining distance as % of route (0 = at end) */
  remainingDistancePercent: number;
  /** Remaining distance in km (approx, route ~30 km) */
  remainingDistanceKm: number;
  /** Last ingest write on the server (`tracker_latest.updated_at`), ISO string */
  lastUpdated: string;
  /** Tracker position (for distance to station) */
  latitude?: number;
  longitude?: number;
  /** Single ETA in direction of travel, e.g. "12 min to Batangas Grand Terminal" or "N/A" */
  etaInDirectionOfTravel?: string;
  /** true = toward Lipa (100%), false = toward Batangas (0%). */
  headingTowardLipa?: boolean | null;
  direction?: number;
  /** From DB: accept new ingest reports for this device (default true if omitted). */
  ingestEnabled?: boolean;
  /** Per-device scraping interval in ms (optional; when unset, global/default interval applies). */
  scrapeIntervalMs?: number;
};
const SEED_VEHICLES: Omit<TrackerVehicle, 'currentPosition' | 'remainingDistancePercent' | 'remainingDistanceKm' | 'lastUpdated'>[] = [
  { id: 'V1', plateNumber: 'ABC-1234', driver: 'Juan Dela Cruz', speed: 45, status: 'online', passengers: 12, capacity: 20, trackerOnline: true },
  { id: 'V2', plateNumber: 'XYZ-5678', driver: 'Maria Santos', speed: 40, status: 'online', passengers: 18, capacity: 20, trackerOnline: true },
  { id: 'V3', plateNumber: 'DEF-9012', driver: 'Pedro Reyes', speed: 0, status: 'online', passengers: 15, capacity: 20, trackerOnline: true },
  { id: 'V4', plateNumber: 'GHI-3456', driver: 'Ana Lopez', speed: 42, status: 'offline', passengers: 10, capacity: 20, trackerOnline: false },
  { id: 'V5', plateNumber: 'JKL-7890', driver: 'Carlos Gomez', speed: 38, status: 'online', passengers: 20, capacity: 20, trackerOnline: true },
  { id: 'V6', plateNumber: 'MNO-2345', driver: 'Elena Torres', speed: 0, status: 'offline', passengers: 0, capacity: 20, trackerOnline: false },
  { id: 'V7', plateNumber: 'PQR-6789', driver: 'Miguel Diaz', speed: 44, status: 'online', passengers: 14, capacity: 20, trackerOnline: true },
  { id: 'V8', plateNumber: 'STU-0123', driver: 'Rosa Martinez', speed: 41, status: 'online', passengers: 8, capacity: 20, trackerOnline: true },
  { id: 'V9', plateNumber: 'VWX-4567', driver: 'Jose Cruz', speed: 39, status: 'online', passengers: 16, capacity: 20, trackerOnline: true },
  { id: 'V10', plateNumber: 'YZA-8901', driver: 'Linda Reyes', speed: 0, status: 'offline', passengers: 0, capacity: 20, trackerOnline: false },
];

/** Base time for simulation: 1 hour ago so vehicles are spread along route */
const SIM_START = Date.now() - 60 * 60 * 1000;

function advancePosition(initialPosition: number, speedKmh: number, elapsedMinutes: number): number {
  // position increase per minute = (speed km/h) / 60 * (route is 100 units) / (ROUTE_LENGTH_KM) * 100
  // Simplified: treat position as 0–100; speed gives % per hour = speed/30 (if route 30km), so per minute = speed/30/60
  const delta = (speedKmh / ROUTE_LENGTH_KM) * (elapsedMinutes / 60) * 100;
  return Math.min(100, initialPosition + delta);
}

/** Initial positions (0–100) for each vehicle so they start spread out */
const INITIAL_POSITIONS = [15, 65, 35, 5, 72, 50, 22, 88, 45, 10];

export function getVehicles(): TrackerVehicle[] {
  const now = Date.now();
  const elapsedMinutes = (now - SIM_START) / (60 * 1000);

  return SEED_VEHICLES.map((v, i) => {
    const initialPosition = INITIAL_POSITIONS[i] ?? 0;
    const currentPosition = advancePosition(initialPosition, v.speed, elapsedMinutes);
    const headingTowardLipa = true as boolean; // simulated state only advances toward Lipa
    const remainingDistancePercent = headingTowardLipa ? Math.max(0, 100 - currentPosition) : Math.max(0, currentPosition);
    const remainingDistanceKm = (remainingDistancePercent / 100) * ROUTE_LENGTH_KM;
    const lastUpdated = v.trackerOnline ? new Date(now).toISOString() : new Date(now - 5 * 60 * 1000).toISOString();
    const eta = computeEtaInDirectionOfTravel(currentPosition, v.speed, headingTowardLipa);
    const etaInDirectionOfTravel =
      eta.etaText === 'N/A' ? `N/A to ${eta.etaLabel}` : `${eta.etaText} to ${eta.etaLabel}`;

    return {
      ...v,
      currentPosition,
      remainingDistancePercent,
      remainingDistanceKm,
      lastUpdated,
      etaInDirectionOfTravel,
      headingTowardLipa,
    };
  });
}
