/**
 * Distance between two points (lat/lng) in km using haversine formula.
 */
export function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Speed in km/h from two positions and timestamps.
 * Used when hardware does not send speed; we derive it from lat, long, timestamp.
 * Returns 0 if time delta is zero or negative, or if positions are missing.
 */
export function speedKmhFromPoints(
  lat1: number,
  lng1: number,
  t1Ms: number,
  lat2: number,
  lng2: number,
  t2Ms: number
): number {
  const dtMs = t2Ms - t1Ms;
  if (dtMs <= 0) return 0;
  const distKm = distanceKm(lat1, lng1, lat2, lng2);
  const hours = dtMs / (1000 * 60 * 60);
  return hours > 0 ? distKm / hours : 0;
}

/** Total route distance in km along ordered stops (sum of segments between consecutive points). */
export function routeDistanceKm(
  stops: Array<{ latitude: number; longitude: number }>
): number {
  if (stops.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    total += distanceKm(
      stops[i].latitude,
      stops[i].longitude,
      stops[i + 1].latitude,
      stops[i + 1].longitude
    );
  }
  return total;
}
