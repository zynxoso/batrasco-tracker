import { BATRASCO_ROUTE_PATH } from '../../data/batrasco-route-path';

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function closestPointOnSegmentLatLng(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): { lat: number; lng: number } {
  const φ = ((aLat + bLat + pLat) / 3) * (Math.PI / 180);
  const k = Math.cos(φ);
  const px = pLng * k;
  const py = pLat;
  const ax = aLng * k;
  const ay = aLat;
  const bx = bLng * k;
  const by = bLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { lat: ay + t * dy, lng: (ax + t * dx) / k };
}

export function minCrossTrackDistanceKmToPolyline(
  lat: number,
  lng: number,
  polyline: readonly [number, number][]
): number {
  if (polyline.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const [aLat, aLng] = polyline[i];
    const [bLat, bLng] = polyline[i + 1];
    const q = closestPointOnSegmentLatLng(lat, lng, aLat, aLng, bLat, bLng);
    const d = haversineKm(lat, lng, q.lat, q.lng);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Cross-track tolerance in km. A vehicle is on track when its reported GPS point lies within this
 * perpendicular distance of the nearest segment of the routing polyline.
 *
 * 50 m covers real-world offsets that a vehicle physically on the road will always have:
 *   - consumer GPS noise (~5–20 m on Sinotrack hardware),
 *   - lane/road width vs the OSRM route centerline (~3–10 m),
 *   - minor polyline simplification between OSRM waypoints.
 *
 * A stricter "exactly on the polyline" check would only work for simulated/test vehicles whose
 * positions are generated on the line, and would incorrectly flag every real vehicle as off track.
 */
export const ROUTE_VALIDATOR_MAX_CROSS_TRACK_KM = 0.05;

/** Slack for haversine / floating-point so a point right at the boundary is not flipped by rounding. */
const ON_TRACK_CROSS_TRACK_EPS_KM = 1e-9;

export type DeviceTrackStatus = 'on_track' | 'off_track' | 'no_fix';

/** `true` = on track, `false` = off track, `null` = no GPS (not true/false). */
export function isDeviceOnTrack(
  latitude: number | undefined,
  longitude: number | undefined,
  maxCrossTrackKm: number = ROUTE_VALIDATOR_MAX_CROSS_TRACK_KM
): boolean | null {
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  const d = minCrossTrackDistanceKmToPolyline(latitude, longitude, BATRASCO_ROUTE_PATH);
  return d <= maxCrossTrackKm + ON_TRACK_CROSS_TRACK_EPS_KM;
}

export function getDeviceTrackStatus(
  latitude: number | undefined,
  longitude: number | undefined,
  maxCrossTrackKm?: number
): DeviceTrackStatus {
  const v = isDeviceOnTrack(latitude, longitude, maxCrossTrackKm);
  if (v === null) return 'no_fix';
  return v ? 'on_track' : 'off_track';
}

export function deviceTrackStatusLabel(status: DeviceTrackStatus): string {
  switch (status) {
    case 'on_track':
      return 'On track';
    case 'off_track':
      return 'Off track';
    case 'no_fix':
      return 'No fix';
  }
}
