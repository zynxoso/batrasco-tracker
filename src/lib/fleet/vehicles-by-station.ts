import type { Station, Vehicle } from '../../App';
import {
  isAtStationTouch,
  isBatangasRouteTerminus,
  isInsideStationGeofence,
  isLipaRouteTerminus,
  resolveDirectionAlongRoute,
} from '../route/route-geometry';
/** Max distance (route %) from station to show vehicle as relevant to that station. */
const RELEVANCE_BAND = 25;

/** After leaving a stop, keep the vehicle in that stop's column only this long; then show it under the next stop (arriving). */
export const DEPARTED_GRACE_MS = 5 * 60 * 1000;

/**
 * Min fraction (0–1) of the segment from the departed stop to the **immediate** next stop in direction of travel
 * (e.g. Makalintal 50% → Lipa 100%) before the vehicle is listed under that next stop instead of the departed one.
 * 10% of that leg ≈ route position 55% when leaving from 50%.
 */
export const DEPARTED_LEG_PROGRESS_MIN = 0.1;

export type DepartedTimestamps = Map<string, number>;

export type StationVehicleStatus = 'arriving' | 'at_station' | 'departed';

export const stationVehicleStatusLabel = (status: StationVehicleStatus): string =>
  status === 'departed'
    ? 'Departed'
    : status === 'at_station'
      ? 'Arrived'
      : 'Arriving';

/**
 * When no station matches {@link getVehicleStationStatus} (outside relevance bands),
 * assign the vehicle to the nearest stop column with the same arriving/departed/at rules
 * as the main matcher — never a fourth synthetic status.
 */
function inferStationStatusWhenNoCandidates(vehicle: Vehicle, station: Station): StationVehicleStatus {
  if (isInsideStationGeofence(vehicle, station)) return 'at_station';

  const pos = vehicle.currentPosition;
  const stationPos = station.position;
  const dir = resolveDirectionAlongRoute(vehicle);
  const towardLipa = dir === 'to_lipa';

  if (isAtStationTouch(pos, stationPos)) {
    return 'at_station';
  }
  if (isBatangasRouteTerminus(station) && towardLipa) {
    return 'departed';
  }
  if (isLipaRouteTerminus(station) && dir === 'to_batangas') {
    return 'departed';
  }
  if (towardLipa) {
    return stationPos > pos ? 'arriving' : 'departed';
  }
  return stationPos < pos ? 'arriving' : 'departed';
}

export function getVehicleStationStatus(
  vehicle: Vehicle,
  station: Station
): StationVehicleStatus | null {
  // Geofence override: parked inside the declared terminal box = arrived,
  // regardless of along-corridor position, relevance band, or direction.
  if (isInsideStationGeofence(vehicle, station)) return 'at_station';

  const pos = vehicle.currentPosition;
  const stationPos = station.position;
  const relevant = Math.abs(pos - stationPos) <= RELEVANCE_BAND;
  if (!relevant) return null;

  const dir = resolveDirectionAlongRoute(vehicle);
  const towardLipa = dir === 'to_lipa';
  if (isBatangasRouteTerminus(station) && towardLipa) return null;
  if (isLipaRouteTerminus(station) && dir === 'to_batangas') return null;

  if (isAtStationTouch(pos, stationPos)) return 'at_station';
  if (towardLipa) {
    return stationPos > pos ? 'arriving' : 'departed';
  }
  return stationPos < pos ? 'arriving' : 'departed';
}

/** Key: `${vehicleId}:${stationId}` → first time we saw that vehicle as departed from that station. */
export function syncDepartedTimestamps(
  vehicles: Vehicle[],
  stations: Station[],
  map: DepartedTimestamps,
  now: number
): void {
  for (const v of vehicles) {
    for (const s of stations) {
      const key = `${v.id}:${s.id}`;
      const st = getVehicleStationStatus(v, s);
      if (st === 'departed') {
        if (!map.has(key)) {
          map.set(key, now);
        }
      } else if (map.has(key)) {
        map.delete(key);
      }
    }
  }
}

/** Next stop along the route after `fromStation` in the vehicle's direction (not based on current GPS position). */
export function immediateNextStopFrom(
  vehicle: Vehicle,
  fromStation: Station,
  stations: Station[]
): Station | null {
  const sorted = [...stations].sort((a, b) => a.position - b.position);
  if (resolveDirectionAlongRoute(vehicle) === 'to_lipa') {
    return sorted.find((s) => s.position > fromStation.position) ?? null;
  }
  return [...sorted].reverse().find((s) => s.position < fromStation.position) ?? null;
}

/**
 * How far the vehicle has moved along the leg from `departedStation` to the immediate next stop (0 at the departed
 * stop, 1 at the next stop). Returns null if that leg cannot be defined.
 */
export function fractionAlongDepartedLegToNextStop(
  vehicle: Vehicle,
  departedStation: Station,
  stations: Station[]
): number | null {
  const next = immediateNextStopFrom(vehicle, departedStation, stations);
  if (!next) return null;
  const from = departedStation.position;
  const to = next.position;
  const span = to - from;
  const leg = Math.abs(span);
  if (leg < 1e-9) return null;
  const pos = vehicle.currentPosition;
  const towardLipa = resolveDirectionAlongRoute(vehicle) === 'to_lipa';
  const raw = towardLipa ? (pos - from) / span : (from - pos) / (from - to);
  return Math.min(1, Math.max(0, raw));
}

export function getDestinationStationForList(
  vehicle: Vehicle,
  stations: Station[],
  currentSectionStation: Station,
  status: StationVehicleStatus
): Station | null {
  if (status === 'arriving') return currentSectionStation;
  if (status === 'at_station') return null;
  const sorted = [...stations].sort((a, b) => a.position - b.position);
  const towardLipa = resolveDirectionAlongRoute(vehicle) === 'to_lipa';
  if (towardLipa) {
    const next = sorted.find((s) => s.position > vehicle.currentPosition);
    return next ?? sorted[sorted.length - 1];
  }
  const next = [...sorted].reverse().find((s) => s.position < vehicle.currentPosition);
  return next ?? sorted[0];
}

export type EntriesByStationOptions = {
  departedAt?: DepartedTimestamps;
  now?: number;
  departedGraceMs?: number;
  /** Min fraction of departed-stop → next-stop leg to reassign early; default {@link DEPARTED_LEG_PROGRESS_MIN}. */
  legProgressMin?: number;
};

/**
 * One row per vehicle: closest station where status logic applies; else nearest stop with inferred
 * {@link inferStationStatusWhenNoCandidates}.
 * If the closest match is "departed" but an "arriving" candidate exists for the next stop, the vehicle moves to that
 * column when either {@link DEPARTED_GRACE_MS} has passed or it has covered at least {@link DEPARTED_LEG_PROGRESS_MIN}
 * of the leg from the departed stop to that next stop.
 */
export function entriesByStationForAllVehicles(
  vehicles: Vehicle[],
  stations: Station[],
  options?: EntriesByStationOptions
): Map<string, Array<{ vehicle: Vehicle; status: StationVehicleStatus }>> {
  const map = new Map<string, Array<{ vehicle: Vehicle; status: StationVehicleStatus }>>();
  for (const s of stations) {
    map.set(s.id, []);
  }

  const departedAt = options?.departedAt;
  const now = options?.now ?? Date.now();
  const graceMs = options?.departedGraceMs ?? DEPARTED_GRACE_MS;
  const legProgressMin = options?.legProgressMin ?? DEPARTED_LEG_PROGRESS_MIN;

  for (const vehicle of vehicles) {
    const candidates: Array<{ station: Station; status: StationVehicleStatus; dist: number }> = [];
    for (const station of stations) {
      const status = getVehicleStationStatus(vehicle, station);
      if (status) {
        candidates.push({
          station,
          status,
          dist: Math.abs(vehicle.currentPosition - station.position),
        });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.dist - b.dist);
      let { station, status } = candidates[0];

      if (status === 'departed') {
        const legFrac = fractionAlongDepartedLegToNextStop(vehicle, station, stations);
        const progressedEnough = legFrac != null && legFrac >= legProgressMin;

        let timeGraceElapsed = false;
        if (departedAt) {
          const firstDeparted = departedAt.get(`${vehicle.id}:${station.id}`);
          const elapsed = firstDeparted != null ? now - firstDeparted : 0;
          timeGraceElapsed = elapsed >= graceMs;
        }

        if (progressedEnough || timeGraceElapsed) {
          const nextStop = immediateNextStopFrom(vehicle, station, stations);
          const arrivingAhead = candidates
            .filter((c) => c.status === 'arriving')
            .sort((a, b) => a.dist - b.dist);
          const preferred =
            nextStop != null
              ? arrivingAhead.find((c) => c.station.id === nextStop.id) ?? arrivingAhead[0]
              : arrivingAhead[0];
          if (preferred) {
            station = preferred.station;
            status = preferred.status;
          } else if (nextStop != null) {
            // Next stop may be outside RELEVANCE_BAND (e.g. Lipa at 100% while bus is ~55%) but should still own the row.
            station = nextStop;
            status = 'arriving';
          }
        }
      }

      map.get(station.id)!.push({ vehicle, status });
    } else {
      const nearest = stations.reduce((best, s) =>
        Math.abs(vehicle.currentPosition - s.position) < Math.abs(vehicle.currentPosition - best.position) ? s : best
      );
      const status = inferStationStatusWhenNoCandidates(vehicle, nearest);
      map.get(nearest.id)!.push({ vehicle, status });
    }
  }

  for (const s of stations) {
    const list = map.get(s.id)!;
    list.sort((a, b) => a.vehicle.currentPosition - b.vehicle.currentPosition);
  }

  return map;
}
