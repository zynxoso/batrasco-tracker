import type { Station, Vehicle } from '../../App';
import {
  CORRIDOR_EAST_ENDPOINT,
  isAtStationTouch,
  isInsideStationGeofence,
  ROUTE_LENGTH_KM,
  type DirectionAlongRoute,
} from '../route/route-geometry';
import { immediateNextStopFrom } from './vehicles-by-station';

const STORAGE_KEY = 'batrasco:station-leg-records';
const MAX_RECORDS = 80;

/** Synthetic east terminus for inter-stop legs (not in `stations` from route-stations). */
export const SM_CORRIDOR_STATION_ID = 'sm-corridor-east';

export type StationLegRecord = {
  id: string;
  vehicleId: string;
  plateNumber: string;
  /** 1 = westernmost along corridor, …, 4 = SM east end (leg tracker order). */
  fromOrder: number;
  toOrder: number;
  fromLabel: string;
  toLabel: string;
  durationMs: number;
  completedAt: number;
  direction: DirectionAlongRoute;
};

export type LegTrackerMemory = {
  /** Last tick: which waypoint id the vehicle was physically at, or null if between stops. */
  prevAtId: Map<string, string | null>;
  /**
   * Open leg after leaving `fromId`, heading to `toId`, until arrival at `toId`
   * (or until cleared).
   */
  openLeg: Map<
    string,
    {
      fromId: string;
      toId: string;
      startedAt: number;
    }
  >;
};

export function createLegTrackerMemory(): LegTrackerMemory {
  return { prevAtId: new Map(), openLeg: new Map() };
}

function sortedStations(stations: Station[]): Station[] {
  return [...stations].sort((a, b) => a.position - b.position);
}

/** Passenger stops + SM east end, sorted by `position`. */
export function stationsWithSmTerminal(stations: Station[]): Station[] {
  const base = sortedStations(stations);
  const sm: Station = {
    id: SM_CORRIDOR_STATION_ID,
    stationNumber: 0,
    name: 'SM Lipa',
    location: 'Lipa City',
    position: 100,
    latitude: CORRIDOR_EAST_ENDPOINT.lat,
    longitude: CORRIDOR_EAST_ENDPOINT.lng,
  };
  return [...base, sm].sort((a, b) => a.position - b.position);
}

function routeOrder(s: Station, ordered: Station[]): number {
  const i = ordered.findIndex((x) => x.id === s.id);
  return i < 0 ? 0 : i + 1;
}

function isVehicleAtStop(vehicle: Vehicle, station: Station): boolean {
  if (isInsideStationGeofence(vehicle, station)) return true;
  return isAtStationTouch(vehicle.currentPosition, station.position);
}

/**
 * Easternmost waypoint the vehicle is deemed “at” (so SM wins over JP when both
 * geofences could apply).
 */
function findAtStation(vehicle: Vehicle, ordered: Station[]): Station | null {
  let best: Station | null = null;
  for (const s of ordered) {
    if (!isVehicleAtStop(vehicle, s)) continue;
    if (!best || s.position > best.position) best = s;
  }
  return best;
}

/**
 * Next waypoint after leaving `from` using along-corridor position (not
 * `resolveDirectionAlongRoute`, which forces westbound in the SM tail and
 * broke JP→SM legs).
 */
export function nextWaypointAfterLeaving(from: Station, vehicle: Vehicle, orderedWithSm: Station[]): Station | null {
  const pos = vehicle.currentPosition;
  const fromPos = from.position;
  const leaveEpsPct =
    ROUTE_LENGTH_KM > 0 ? Math.min(0.35, Math.max(0.05, (0.04 / ROUTE_LENGTH_KM) * 100)) : 0.12;
  const passengerOnly = orderedWithSm.filter((s) => s.id !== SM_CORRIDOR_STATION_ID);
  const hasEast = orderedWithSm.some((s) => s.position > fromPos);
  const hasWest = orderedWithSm.some((s) => s.position < fromPos);

  if (hasEast && pos > fromPos + leaveEpsPct) {
    return orderedWithSm.find((s) => s.position > fromPos) ?? null;
  }
  if (hasWest && pos < fromPos - leaveEpsPct) {
    return [...orderedWithSm].reverse().find((s) => s.position < fromPos) ?? null;
  }
  /** One-way terminus (Palico west / SM east): any movement away from the pin is unambiguous. */
  if (hasEast && !hasWest && pos > fromPos) {
    return orderedWithSm.find((s) => s.position > fromPos) ?? null;
  }
  if (hasWest && !hasEast && pos < fromPos) {
    return [...orderedWithSm].reverse().find((s) => s.position < fromPos) ?? null;
  }
  return immediateNextStopFrom(vehicle, from, passengerOnly);
}

function loadRecordsFromStorage(): StationLegRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { records?: StationLegRecord[] };
    return Array.isArray(parsed?.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

export function loadStationLegRecords(): StationLegRecord[] {
  return loadRecordsFromStorage();
}

export function persistStationLegRecords(records: StationLegRecord[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ records: records.slice(0, MAX_RECORDS) }));
  } catch {
    /* ignore quota */
  }
}

/**
 * For each online vehicle, detect leave one stop / arrive at the next along the
 * corridor (including SM east end), and emit completed legs with duration.
 */
export function tickStationLegs(
  vehicles: Vehicle[],
  stations: Station[],
  mem: LegTrackerMemory,
  onComplete: (r: StationLegRecord) => void,
  options?: { nowMs?: number }
): void {
  const now = options?.nowMs ?? Date.now();
  const orderedWithSm = stationsWithSmTerminal(stations);
  const byId = new Map(orderedWithSm.map((s) => [s.id, s] as const));

  for (const v of vehicles) {
    if (v.status !== 'online') continue;
    if (v.latitude == null && v.currentPosition == null) continue;

    const at = findAtStation(v, orderedWithSm);
    const prevId = mem.prevAtId.get(v.id) ?? null;
    const vid = v.id;

    if (at) {
      const open = mem.openLeg.get(vid);
      if (open && open.toId === at.id) {
        const fromS = byId.get(open.fromId);
        if (fromS) {
          const toS = at;
          const direction: DirectionAlongRoute =
            toS.position > fromS.position ? 'to_lipa' : 'to_batangas';
          const durationMs = now - open.startedAt;
          if (durationMs >= 0 && durationMs < 6 * 60 * 60 * 1000) {
            onComplete({
              id:
                typeof crypto !== 'undefined' && 'randomUUID' in crypto
                  ? `leg-${crypto.randomUUID()}`
                  : `leg-${vid}-${open.startedAt}-${toS.id}`,
              vehicleId: vid,
              plateNumber: v.plateNumber,
              fromOrder: routeOrder(fromS, orderedWithSm),
              toOrder: routeOrder(toS, orderedWithSm),
              fromLabel: fromS.name,
              toLabel: toS.name,
              durationMs,
              completedAt: now,
              direction,
            });
          }
        }
        mem.openLeg.delete(vid);
      }
      mem.prevAtId.set(vid, at.id);
      continue;
    }

    if (prevId && !mem.openLeg.has(vid)) {
      const prevStation = byId.get(prevId);
      if (prevStation) {
        const next = nextWaypointAfterLeaving(prevStation, v, orderedWithSm);
        if (next) {
          mem.openLeg.set(vid, { fromId: prevId, toId: next.id, startedAt: now });
          mem.prevAtId.set(vid, null);
        }
      } else {
        mem.prevAtId.set(vid, null);
      }
    } else if (!prevId && !mem.openLeg.has(vid)) {
      mem.prevAtId.set(vid, null);
    }
  }
}

export function formatLegDurationMs(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  if (m < 60) return r > 0 ? `${m}m ${r}s` : `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
}

/** Whole minutes (rounded) for analytics / titles. */
export function formatLegDurationMinutesRounded(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes === 0) return '< 1 min';
  return `${minutes} min`;
}

export function directionLabel(d: DirectionAlongRoute): string {
  return d === 'to_lipa' ? 'Toward J.P. Laurel (east)' : 'Toward Palico (west)';
}
