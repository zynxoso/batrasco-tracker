/**
 * Copy to sinotrack-portal-transform.local.js (gitignored if you add it) and set:
 *   SINOTRACK_PORTAL_TRANSFORM=./scripts/sinotrack-portal-transform.local.js
 *
 * Implement extractReports(portalJson) and return an array of plain objects with
 * at least: imei or device_id, lat (or latitude), lng (or longitude).
 * Optional: reported_at (ISO string | unix s | ms), battery_percent, direction
 */

function extractReports(data) {
  // Example: portal returns { code: 0, data: { devices: [ ... ] } }
  const list = data?.data?.devices ?? data?.devices ?? [];
  return list.map((d) => ({
    device_id: String(d.imei ?? d.sn ?? ''),
    lat: d.lat ?? d.latitude,
    lng: d.lng ?? d.longitude,
    reported_at: d.gpsTime ?? d.locTime ?? d.time,
    battery_percent: d.battery,
    direction: d.course,
  }));
}

module.exports = { extractReports };
