/**
 * Types for Sinotrack tracker input payloads.
 * Hardware provides: device_id, lat, long, timestamp, direction, device state (battery %, online/offline).
 * Speed is NOT sent by the device; it is computed from consecutive (lat, long, timestamp) points.
 */

import { latLngToPositionPercent } from '../route/route-geometry';

/** Single report from tracker hardware (or gateway forwarding it) */
export type SinotrackReportInput = {
  /** Device identifier (IMEI, serial, or our vehicle_id e.g. V1, V2) */
  device_id?: string;
  imei?: string;
  /** Latitude (GPS) */
  lat?: number;
  latitude?: number;
  /** Longitude (GPS) */
  lng?: number;
  longitude?: number;
  /** When the device recorded this (ISO string or ms) */
  reported_at?: string | number;
  /** Direction of travel (e.g. degrees 0–360, or cardinal). Optional. */
  direction?: number | string;
  /** Device state: battery level 0–100. Optional. */
  battery_percent?: number;
  /** Device state: online/offline. Optional; if not sent, we derive from report recency. */
  status?: 'online' | 'offline';
  /** Route position 0–100 (if already computed by device or gateway). Otherwise derived from lat/lng. */
  position_percent?: number;
  /** Legacy: if gateway sends speed, we can still accept it; otherwise speed is computed from lat/lng/timestamp. */
  speed_kmh?: number;
  speed?: number;
};

/** Batch payload: multiple reports in one request (e.g. 5s interval bulk) */
export type SinotrackIngestBody = {
  reports: SinotrackReportInput[];
};

/** Normalized row we persist to the database (and read from tracker_latest / tracker_reports). */
export type TrackerReportRow = {
  vehicle_id: string;
  /** Computed from consecutive (lat, long, timestamp) when available; otherwise 0 or legacy value from payload. */
  speed_kmh: number;
  position_percent: number;
  reported_at: string; // ISO
  latitude?: number;
  longitude?: number;
  /** Direction of travel (degrees 0–360 or similar). From hardware. */
  direction?: number;
  /** Battery level 0–100. From hardware. */
  battery_percent?: number;
  /** Present when read from tracker_latest or set from ingest; 'online' | 'offline'. */
  status?: 'online' | 'offline';
  /** Present when read from tracker_latest; not set from ingest. */
  vehicle_name?: string;
  /** Inferred on upsert from position delta; true = toward Lipa (100%). */
  heading_toward_lipa?: boolean | null;
  /** When false (from tracker_latest), ingest skips updates for this device. */
  ingest_enabled?: boolean;
  /** Per-device scraping interval in ms (from tracker_latest; optional). */
  scrape_interval_ms?: number;
};

function getPositionPercent(raw: SinotrackReportInput): number {
  if (typeof raw.position_percent === 'number') return Math.min(100, Math.max(0, raw.position_percent));
  const lat = raw.lat ?? raw.latitude;
  const lng = raw.lng ?? raw.longitude;
  if (typeof lat === 'number' && typeof lng === 'number') return latLngToPositionPercent(lat, lng);
  return 0;
}

function parseDirection(raw: SinotrackReportInput): number | undefined {
  const d = raw.direction;
  if (typeof d === 'number' && !Number.isNaN(d)) return d;
  if (typeof d === 'string' && d.trim() !== '') {
    const n = Number(d);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function parseBatteryPercent(raw: SinotrackReportInput): number | undefined {
  const b = raw.battery_percent;
  if (typeof b !== 'number' || Number.isNaN(b)) return undefined;
  return Math.max(0, Math.min(100, b));
}

export function normalizeSinotrackReport(raw: SinotrackReportInput): TrackerReportRow | null {
  const vehicleId = (raw.device_id ?? raw.imei)?.trim();
  if (!vehicleId) return null;

  const position = getPositionPercent(raw);
  const reportedAt = raw.reported_at
    ? (typeof raw.reported_at === 'number' ? new Date(raw.reported_at).toISOString() : String(raw.reported_at))
    : new Date().toISOString();

  const lat = raw.lat ?? raw.latitude;
  const lng = raw.lng ?? raw.longitude;
  const latitude = typeof lat === 'number' ? lat : undefined;
  const longitude = typeof lng === 'number' ? lng : undefined;

  const direction = parseDirection(raw);
  const battery_percent = parseBatteryPercent(raw);
  const status =
    raw.status === 'online' || raw.status === 'offline' ? raw.status : undefined;

  const speedFromPayload =
    typeof raw.speed_kmh === 'number' ? raw.speed_kmh : typeof raw.speed === 'number' ? raw.speed : undefined;

  return {
    vehicle_id: vehicleId,
    speed_kmh: speedFromPayload ?? 0,
    position_percent: position,
    reported_at: reportedAt,
    ...(latitude != null && longitude != null ? { latitude, longitude } : {}),
    ...(direction != null ? { direction } : {}),
    ...(battery_percent != null ? { battery_percent } : {}),
    ...(status != null ? { status } : {}),
  };
}
