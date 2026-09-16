/**
 * BATRASCO route geometry:
 * 0% = Palico–Balayan (Batangas City, first stop), ~52.7% = San Jose (middle
 * stop), ~80.1% = J.P. Laurel Hwy (Lipa City, last passenger stop), 100% =
 * SM Lipa (corridor endpoint, NOT a stop — extension for parked vehicles).
 * lat/lng snaps onto the actual driving path in src/data/batrasco-route-path.ts.
 */

import { distanceKm } from './distance';
import { BATRASCO_ROUTE_PATH } from '../../data/batrasco-route-path';

const ROUTE_BATANGAS = { lat: 13.7641749, lng: 121.0562022 };
/** East endpoint of the tracking corridor (SM Lipa). Not a passenger stop — the
 *  last stop is J.P. Laurel Hwy at ~80% and the corridor continues past it out
 *  here so vehicles that park beyond the stop still read as on-track. */
const ROUTE_LIPA = { lat: 13.954967, lng: 121.160271 } as const;

/** Exported for station-to-station leg tracking at the corridor east end. */
export const CORRIDOR_EAST_ENDPOINT = ROUTE_LIPA;
/** Coordinates of the easternmost *passenger stop* (J.P. Laurel Hwy). The
 *  direction-of-travel ETA east targets this point, not the 100% corridor
 *  endpoint at SM, so "N min to J.P. Laurel Hwy" stays truthful for vehicles
 *  sitting between the last stop and SM. */
const ROUTE_LAST_STOP_EAST = { lat: 13.9394312, lng: 121.122812 };

const ROUTE_PATH_POINTS = BATRASCO_ROUTE_PATH.map(([lat, lng]) => ({ lat, lng }));
const ROUTE_PATH_CUMULATIVE_KM: number[] = [0];
for (let i = 1; i < ROUTE_PATH_POINTS.length; i++) {
  ROUTE_PATH_CUMULATIVE_KM[i] =
    ROUTE_PATH_CUMULATIVE_KM[i - 1] +
    distanceKm(
      ROUTE_PATH_POINTS[i - 1].lat,
      ROUTE_PATH_POINTS[i - 1].lng,
      ROUTE_PATH_POINTS[i].lat,
      ROUTE_PATH_POINTS[i].lng
    );
}

/** End-to-end driving distance along the published BATRASCO corridor. */
export const ROUTE_LENGTH_KM = ROUTE_PATH_CUMULATIVE_KM[ROUTE_PATH_CUMULATIVE_KM.length - 1] ?? 0;

/**
 * When reported speed is positive but very low, raw distance/speed overstates ETA (GPS noise,
 * stop–go sampling). ETA display uses at least this speed so nearer vehicles are not shown as
 * hours behind farther ones solely due to a tiny speed denominator. Speed ≤ 0 still means N/A.
 */
export const ETA_MIN_EFFECTIVE_SPEED_KMH = 10;

export function effectiveSpeedKmhForEta(speedKmh: number): number {
  if (speedKmh <= 0) return speedKmh;
  return Math.max(speedKmh, ETA_MIN_EFFECTIVE_SPEED_KMH);
}

export type RouteProjection = {
  distanceKmFromStart: number;
  positionPercent: number;
  lateralDistanceKm: number;
};

/**
 * Position 0–100 along route: 0 = Batangas (station 1), 100 = Lipa (station 3).
 */
export function latLngToPositionPercent(lat: number, lng: number): number {
  return Math.round(projectLatLngOntoRoute(lat, lng).positionPercent * 1000) / 1000;
}

/** ETA label when the bus is traveling toward Lipa (increasing %). */
export const ETA_LABEL_TO_LIPA = 'J.P. Laurel Hwy';
/** ETA label when the bus is traveling toward Batangas (decreasing %). */
export const ETA_LABEL_TO_BATANGAS = 'Palico–Balayan (Batangas)';

/** @deprecated Use ETA_LABEL_TO_LIPA / ETA_LABEL_TO_BATANGAS (old geometry had 0=Lipa). */
export const ETA_LABEL_SM_LIPA = ETA_LABEL_TO_LIPA;
/** @deprecated */
export const ETA_LABEL_BATANGAS = ETA_LABEL_TO_BATANGAS;

export type ETAInDirectionOfTravel = {
  etaText: string;
  etaLabel: typeof ETA_LABEL_TO_LIPA | typeof ETA_LABEL_TO_BATANGAS;
};

/**
 * ETA to route terminus in the current direction of travel.
 * @param headingTowardLipa true = toward 100% (Lipa), false = toward 0% (Batangas). If null/undefined, falls back to position < 50 (unreliable mid-route).
 */
export function computeEtaInDirectionOfTravel(
  positionPercent: number,
  speedKmh: number,
  headingTowardLipa?: boolean | null
): ETAInDirectionOfTravel {
  const towardLipa =
    headingTowardLipa === true ? true : headingTowardLipa === false ? false : positionPercent < 50;

  const distanceKm = distanceKmToRouteTerminus(positionPercent, towardLipa);

  const etaLabel = towardLipa ? ETA_LABEL_TO_LIPA : ETA_LABEL_TO_BATANGAS;

  const effSpeed = effectiveSpeedKmhForEta(speedKmh);
  if (effSpeed <= 0 || distanceKm <= 0) {
    return { etaText: 'N/A', etaLabel };
  }

  const minutes = (distanceKm / effSpeed) * 60;
  const etaText = minutes < 1 ? '< 1 min' : `${Math.round(minutes)} min`;
  return { etaText, etaLabel };
}

/**
 * Infer travel direction from consecutive position_percent samples (0 = Batangas, 100 = Lipa).
 */
export function inferHeadingTowardLipa(
  prevPercent: number | null | undefined,
  newPercent: number,
  prevHeading: boolean | null | undefined
): boolean | null {
  if (prevPercent == null || Number.isNaN(newPercent)) {
    if (prevHeading === true || prevHeading === false) return prevHeading;
    return null;
  }
  const d = newPercent - prevPercent;
  if (Math.abs(d) > 0.03) return d > 0;
  if (prevHeading === true || prevHeading === false) return prevHeading;
  return null;
}

/** Initial bearing from Batangas stop toward Lipa stop (degrees, 0–360, clockwise from north). */
export function routeBearingDegToLipa(): number {
  const φ1 = (ROUTE_BATANGAS.lat * Math.PI) / 180;
  const φ2 = (ROUTE_LIPA.lat * Math.PI) / 180;
  const Δλ = ((ROUTE_LIPA.lng - ROUTE_BATANGAS.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function angularDistanceDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * When position-based heading is unknown, compare device GPS heading (0–360°) to the route axis.
 */
export function inferHeadingTowardLipaFromDeviceDirection(
  directionDeg: number | undefined
): boolean | null {
  if (directionDeg == null || Number.isNaN(directionDeg)) return null;
  const toLipa = routeBearingDegToLipa();
  const toBat = (toLipa + 180) % 360;
  const dL = angularDistanceDeg(directionDeg, toLipa);
  const dB = angularDistanceDeg(directionDeg, toBat);
  if (dL < dB) return true;
  if (dB < dL) return false;
  return null;
}

export type DirectionAlongRoute = 'to_lipa' | 'to_batangas';

/**
 * Which way the bus is going along the Batangas→Lipa line for ETA / station logic.
 * 1) GPS `direction` vs route bearing (when unambiguous — beats DB, which may be position-inferred)
 * 2) `headingTowardLipa` from API/DB
 * 3) `motionTowardLipa` from consecutive position samples (client poll)
 * 4) Rough position fallback
 */
export function resolveDirectionAlongRoute(vehicle: {
  headingTowardLipa?: boolean | null;
  direction?: number;
  /** Inferred from position delta on the client when API omits heading; weaker than GPS. */
  motionTowardLipa?: boolean | null;
  currentPosition: number;
}): DirectionAlongRoute {
  // Past the easternmost passenger stop (J.P. Laurel Hwy @ ~80%), the corridor
  // only continues out to SM Lipa — not a stop. For passenger-facing coloring
  // the meaningful direction in that tail is always **back toward Batangas**:
  //  - coming back from SM toward JP Laurel -> west (correct),
  //  - parked at SM with a stale "headingTowardLipa=true" from the prior east
  //    run -> we override the stale flag so the pill turns orange,
  //  - briefly passing east of JP Laurel en route to SM for parking -> it's a
  //    non-passenger segment, so previewing orange ("next real direction is
  //    back west") is still the right cue.
  // Tiny 0.05% tolerance (~14 m on a 28.7 km corridor) keeps buses that are
  // *at* the stop (not past it) on their normal direction inference.
  if (vehicle.currentPosition > LAST_STOP_EAST_PCT + 0.05) return 'to_batangas';

  const fromGps = inferHeadingTowardLipaFromDeviceDirection(vehicle.direction);
  if (fromGps === true) return 'to_lipa';
  if (fromGps === false) return 'to_batangas';
  if (vehicle.headingTowardLipa === true) return 'to_lipa';
  if (vehicle.headingTowardLipa === false) return 'to_batangas';
  if (vehicle.motionTowardLipa === true) return 'to_lipa';
  if (vehicle.motionTowardLipa === false) return 'to_batangas';
  return vehicle.currentPosition < 50 ? 'to_lipa' : 'to_batangas';
}

/**
 * Absolute distance (km) along the corridor within which a vehicle is treated
 * as having **touched / arrived at** a station. 50 m is tight enough to read
 * as "at the stop pin" (≈ terminal street frontage) while still reliably
 * catching a pass-through at 5-second polling / typical bus speeds (~40 km/h
 * ≈ 55 m per tick). Absolute km (not route %) so the threshold is stable if
 * the corridor is later extended.
 */
export const AT_STATION_TOUCH_KM = 0.05;

/** `true` when `vehiclePositionPercent` is within {@link AT_STATION_TOUCH_KM} of `stationPositionPercent` along the corridor. */
export function isAtStationTouch(vehiclePositionPercent: number, stationPositionPercent: number): boolean {
  if (ROUTE_LENGTH_KM <= 0) return false;
  const deltaKm = (Math.abs(vehiclePositionPercent - stationPositionPercent) / 100) * ROUTE_LENGTH_KM;
  return deltaKm <= AT_STATION_TOUCH_KM;
}

/**
 * Axis-aligned lat/lng rectangle. Used to mark the on-the-ground **terminal /
 * parking area** of a stop — a vehicle inside the box counts as "arrived" at
 * that stop regardless of its along-corridor distance or inferred direction
 * (parked buses at terminals can report a random heading from the last
 * second of motion and sit off the route polyline).
 */
export type GeofenceBoundingBox = {
  south: number;
  north: number;
  west: number;
  east: number;
};

export function isInsideStationGeofence(
  vehicle: { latitude?: number; longitude?: number },
  station: { geofence?: GeofenceBoundingBox }
): boolean {
  const box = station.geofence;
  if (!box) return false;
  const lat = vehicle.latitude;
  const lng = vehicle.longitude;
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east;
}
/** Strict lateral tolerance for "on-route" visibility in the dashboard/map. */
export const ROUTE_LINE_TOLERANCE_KM = 0.15;

const EARTH_RADIUS_KM = 6371;

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function latLngToLocalKm(lat: number, lng: number, originLat: number, originLng: number): { x: number; y: number } {
  const meanLat = toRad((lat + originLat) / 2);
  const x = EARTH_RADIUS_KM * toRad(lng - originLng) * Math.cos(meanLat);
  const y = EARTH_RADIUS_KM * toRad(lat - originLat);
  return { x, y };
}

function pointToSegmentDistanceKm(
  point: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const p = latLngToLocalKm(point.lat, point.lng, a.lat, a.lng);
  const aa = { x: 0, y: 0 };
  const bb = latLngToLocalKm(b.lat, b.lng, a.lat, a.lng);
  const vx = bb.x - aa.x;
  const vy = bb.y - aa.y;
  const wx = p.x - aa.x;
  const wy = p.y - aa.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 1e-12) {
    return Math.hypot(wx, wy);
  }
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const projX = aa.x + t * vx;
  const projY = aa.y + t * vy;
  return Math.hypot(p.x - projX, p.y - projY);
}

export function isOnPrimaryRouteLine(
  vehicle: { latitude?: number; longitude?: number },
  toleranceKm = ROUTE_LINE_TOLERANCE_KM
): boolean {
  if (vehicle.latitude == null || vehicle.longitude == null) {
    return false;
  }
  if (!Number.isFinite(vehicle.latitude) || !Number.isFinite(vehicle.longitude)) {
    return false;
  }
  return projectLatLngOntoRoute(vehicle.latitude, vehicle.longitude).lateralDistanceKm <= toleranceKm;
}

export function projectLatLngOntoRoute(lat: number, lng: number): RouteProjection {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || ROUTE_PATH_POINTS.length === 0) {
    return { distanceKmFromStart: 0, positionPercent: 0, lateralDistanceKm: Number.POSITIVE_INFINITY };
  }

  let bestDistanceKm = Number.POSITIVE_INFINITY;
  let bestDistanceFromStartKm = 0;

  for (let i = 1; i < ROUTE_PATH_POINTS.length; i++) {
    const a = ROUTE_PATH_POINTS[i - 1];
    const b = ROUTE_PATH_POINTS[i];
    const p = latLngToLocalKm(lat, lng, a.lat, a.lng);
    const bb = latLngToLocalKm(b.lat, b.lng, a.lat, a.lng);
    const vx = bb.x;
    const vy = bb.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 <= 1e-12 ? 0 : Math.max(0, Math.min(1, (p.x * vx + p.y * vy) / len2));
    const projX = t * vx;
    const projY = t * vy;
    const lateralDistanceKm = Math.hypot(p.x - projX, p.y - projY);
    if (lateralDistanceKm < bestDistanceKm) {
      bestDistanceKm = lateralDistanceKm;
      bestDistanceFromStartKm = ROUTE_PATH_CUMULATIVE_KM[i - 1] + Math.sqrt(len2) * t;
    }
  }

  const boundedDistanceKm = Math.max(0, Math.min(ROUTE_LENGTH_KM, bestDistanceFromStartKm));
  return {
    distanceKmFromStart: boundedDistanceKm,
    positionPercent: ROUTE_LENGTH_KM > 0 ? (boundedDistanceKm / ROUTE_LENGTH_KM) * 100 : 0,
    lateralDistanceKm: bestDistanceKm,
  };
}

/**
 * Percent along the corridor of the **last passenger stop going east**
 * (J.P. Laurel Hwy). Less than 100% whenever the corridor extends past the
 * stop (e.g. out to SM Lipa). Used by direction-of-travel ETA/remaining
 * distance math so "N min to J.P. Laurel Hwy" and `remainingDistanceKm` stay
 * correct for vehicles in the past-last-stop tail. The west terminus Palico
 * sits at exactly 0% so the west counterpart is simply 0.
 */
export const LAST_STOP_EAST_PCT: number =
  projectLatLngOntoRoute(ROUTE_LAST_STOP_EAST.lat, ROUTE_LAST_STOP_EAST.lng).positionPercent;

/**
 * Distance (km) along the corridor from the vehicle to the **last passenger
 * stop** in the direction of travel (J.P. Laurel Hwy east / Palico west). Not
 * the raw 100% / 0% corridor endpoints — see {@link LAST_STOP_EAST_PCT}. A
 * vehicle past the east last-stop (between J.P. Laurel and SM) heading east
 * gets 0 (already past the last stop).
 */
export function distanceKmToRouteTerminus(positionPercent: number, headingTowardLipa: boolean): number {
  const boundedPercent = Math.max(0, Math.min(100, positionPercent));
  if (headingTowardLipa) {
    const remaining = LAST_STOP_EAST_PCT - boundedPercent;
    return remaining > 0 ? (remaining / 100) * ROUTE_LENGTH_KM : 0;
  }
  return (boundedPercent / 100) * ROUTE_LENGTH_KM;
}

/** Western corridor terminus (Palico–Balayan / Batangas City). Detected by
 *  position only so any future stop-at-0 works automatically. */
export function isBatangasRouteTerminus(station: { position: number; id?: string }): boolean {
  return Math.abs(station.position) < 1e-5;
}

/** Eastern corridor terminus — only the 100% endpoint (SM Lipa). J.P. Laurel
 *  Hwy is a stop but NOT the terminus now that the corridor extends past it,
 *  so vehicles between JP Laurel and SM still get a real ETA to the stop. */
export function isLipaRouteTerminus(station: { position: number; id?: string }): boolean {
  return Math.abs(station.position - 100) < 1e-5;
}

/**
 * Distance (km) along the line to this station for passenger “arrival” / ETA display.
 * Returns null when the vehicle is not inbound to that stop (e.g. outbound from Batangas toward Lipa at position 0%).
 */
export function linearDistanceKmToStation(
  vehicle: {
    currentPosition: number;
    headingTowardLipa?: boolean | null;
    direction?: number;
    motionTowardLipa?: boolean | null;
    latitude?: number;
    longitude?: number;
  },
  station: { position: number; id?: string; geofence?: GeofenceBoundingBox }
): number | null {
  // Geofence trumps everything: a vehicle sitting inside the declared terminal
  // / parking area of a stop is unambiguously AT the stop, even if inferred
  // direction would say "outbound from this terminus" (common for parked
  // buses that just departed or are about to depart).
  if (isInsideStationGeofence(vehicle, station)) return 0;

  const pos = vehicle.currentPosition;
  const s = station.position;
  const dir = resolveDirectionAlongRoute(vehicle);
  const towardLipa = dir === 'to_lipa';

  // Terminus: only inbound counts as “arrival” for that end’s passengers.
  if (isBatangasRouteTerminus(station) && towardLipa) return null;
  if (isLipaRouteTerminus(station) && dir === 'to_batangas') return null;

  if (isAtStationTouch(pos, s)) {
    return 0;
  }

  if (towardLipa) {
    if (s <= pos) return null;
    return ((s - pos) / 100) * ROUTE_LENGTH_KM;
  }

  if (s >= pos) return null;
  return ((pos - s) / 100) * ROUTE_LENGTH_KM;
}

/** Next scheduled stop ahead in the current direction of travel (by route %). */
export function nextStationInDirectionOfTravel<
  T extends { position: number },
>(vehicle: Parameters<typeof resolveDirectionAlongRoute>[0], stations: readonly T[]): T | null {
  const sorted = [...stations].sort((a, b) => a.position - b.position);
  const dir = resolveDirectionAlongRoute(vehicle);
  if (dir === 'to_lipa') {
    return sorted.find((s) => s.position > vehicle.currentPosition) ?? null;
  }
  return [...sorted].reverse().find((s) => s.position < vehicle.currentPosition) ?? null;
}
