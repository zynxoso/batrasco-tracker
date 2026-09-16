/**
 * BATRASCO line: three drop-off points span ~21 km end-to-end; 0–100% maps linearly to that distance.
 * Used by tracker mock scripts so position change matches speed × time.
 */

const ROUTE_TOTAL_KM = 21;

/** Hours represented by one reporting interval. */
function hoursFromIntervalMs(intervalMs) {
  return intervalMs / 3600000;
}

/**
 * Change in route percent for one interval at constant speed (straight-line model).
 * Δ% = (distance_km / ROUTE_TOTAL_KM) * 100, distance_km = speed_kmh * Δt_h.
 */
function percentDeltaForSpeed(speedKmh, intervalMs) {
  if (speedKmh <= 0) return 0;
  const km = speedKmh * hoursFromIntervalMs(intervalMs);
  return (km / ROUTE_TOTAL_KM) * 100;
}

/** Initial bearing Batangas stop → Lipa stop (degrees 0–360, clockwise from north). Matches src/lib/route/route-geometry.ts. */
function routeBearingDegToLipa() {
  const ROUTE_BATANGAS = { lat: 13.7641749, lng: 121.0562022 };
  const ROUTE_LIPA = { lat: 13.9394093, lng: 121.1228333 };
  const φ1 = (ROUTE_BATANGAS.lat * Math.PI) / 180;
  const φ2 = (ROUTE_LIPA.lat * Math.PI) / 180;
  const Δλ = ((ROUTE_LIPA.lng - ROUTE_BATANGAS.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function routeBearingDegToBatangas() {
  return (routeBearingDegToLipa() + 180) % 360;
}

module.exports = {
  ROUTE_TOTAL_KM,
  hoursFromIntervalMs,
  percentDeltaForSpeed,
  routeBearingDegToLipa,
  routeBearingDegToBatangas,
};
