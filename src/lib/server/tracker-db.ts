/**
 * Persist Sinotrack reports and read latest vehicle state.
 * Uses Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set;
 * otherwise in-memory store (no DB dependency for local dev).
 * Speed is computed from consecutive (lat, long, timestamp) when previous point exists.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TrackerReportRow } from './sinotrack-types';
import type { TrackerVehicle } from './tracker-state';
import { getVehicles } from './tracker-state';
import {
  computeEtaInDirectionOfTravel,
  distanceKmToRouteTerminus,
  inferHeadingTowardLipa,
  latLngToPositionPercent,
  resolveDirectionAlongRoute,
  ROUTE_LENGTH_KM,
} from '../route/route-geometry';
import { speedKmhFromPoints } from '../route/distance';
import { appendTrackerHistoryPoint, type TrackerHistoryPoint } from './tracker-history-kv';
import { REAL_FLEET_ROSTER, getRealFleetDevice, sortByRealFleetRoster } from './real-fleet-roster';
const STALE_MS = 5 * 60 * 1000; // 5 min without report = tracker offline

let memoryStore: Map<string, TrackerReportRow> = new Map();

/** True when the SELECT failed because a projected column is missing (retry next tier). PGRST204 = PostgREST schema cache; 42703 = Postgres undefined_column. */
function isTrackerLatestSelectRetryable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const c = err.code;
  if (c === 'PGRST204' || c === '42703') return true;
  const m = (err.message ?? '').toLowerCase();
  return m.includes('schema cache') || (m.includes('column') && m.includes('does not exist'));
}

/** Upsert can fail on schema drift (missing columns in tracker_latest). */
function isTrackerLatestUpsertRetryable(
  err: { code?: string; message?: string; details?: string; hint?: string } | null
): boolean {
  if (!err) return false;
  const c = err.code;
  if (c === 'PGRST204' || c === '42703') return true;
  const text = `${err.message ?? ''} ${err.details ?? ''} ${err.hint ?? ''}`.toLowerCase();
  return text.includes('schema cache') || (text.includes('column') && text.includes('does not exist'));
}

export type PersistTrackerReportOptions = {
  /** After a successful SinoTrack scrape, bump `tracker_latest.updated_at` even when GPS `reported_at` did not advance. */
  touchUpdatedAtIfReportUnchanged?: boolean;
};

/** PostgREST: unknown/missing column in schema cache — retry with fewer projected columns instead of falling back to tracker_reports. */
const TRACKER_LATEST_SELECT_TIERS = [
  'device_id, vehicle_name, latitude, longitude, speed_kmh, position_percent, status, reported_at, updated_at, direction, battery_percent, heading_toward_lipa, ingest_enabled, scrape_interval_ms',
  'device_id, vehicle_name, latitude, longitude, speed_kmh, position_percent, status, reported_at, updated_at, direction, battery_percent, ingest_enabled, scrape_interval_ms',
  'device_id, vehicle_name, latitude, longitude, speed_kmh, position_percent, status, reported_at, updated_at, ingest_enabled',
  'device_id, latitude, longitude, speed_kmh, position_percent, reported_at, updated_at, ingest_enabled',
  'device_id, latitude, longitude, speed_kmh, position_percent, reported_at, ingest_enabled',
] as const;

/** Upsert payload tiers: newest schema → lean schema. */
const TRACKER_LATEST_UPSERT_COLUMNS_TIERS = [
  ['device_id', 'speed_kmh', 'position_percent', 'reported_at', 'updated_at', 'status', 'latitude', 'longitude', 'direction', 'battery_percent', 'heading_toward_lipa'],
  ['device_id', 'speed_kmh', 'position_percent', 'reported_at', 'status', 'latitude', 'longitude', 'direction', 'battery_percent'],
  ['device_id', 'speed_kmh', 'position_percent', 'reported_at', 'latitude', 'longitude', 'direction'],
  ['device_id', 'speed_kmh', 'position_percent', 'reported_at', 'latitude', 'longitude'],
  ['device_id', 'speed_kmh', 'position_percent', 'reported_at'],
] as const;

function projectPayloadByColumns(
  payload: Record<string, unknown>,
  columns: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of columns) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) out[key] = payload[key];
  }
  return out;
}

function historySnapshotFromLatestPayload(row: TrackerReportRow, payload: Record<string, unknown>): TrackerHistoryPoint {
  return {
    device_id: String(payload.device_id),
    vehicle_name: row.vehicle_name,
    latitude: payload.latitude != null ? Number(payload.latitude) : undefined,
    longitude: payload.longitude != null ? Number(payload.longitude) : undefined,
    speed_kmh: Number(payload.speed_kmh),
    position_percent: Number(payload.position_percent),
    reported_at: String(payload.reported_at),
    status: String(payload.status ?? 'online'),
    direction: payload.direction != null ? Number(payload.direction) : undefined,
    battery_percent: payload.battery_percent != null ? Number(payload.battery_percent) : undefined,
    heading_toward_lipa:
      payload.heading_toward_lipa === true ? true : payload.heading_toward_lipa === false ? false : undefined,
    stored_at: new Date().toISOString(),
  };
}

async function insertTrackerReportHistoryRow(
  supabase: SupabaseClient,
  row: TrackerReportRow,
  speedKmh: number,
  inferredHeading: boolean | undefined
) {
  const payload: Record<string, unknown> = {
    vehicle_id: row.vehicle_id,
    speed_kmh: speedKmh,
    position_percent: row.position_percent,
    reported_at: row.reported_at,
    status: row.status ?? 'online',
  };
  if (row.latitude != null) payload.latitude = row.latitude;
  if (row.longitude != null) payload.longitude = row.longitude;
  if (row.direction != null) payload.direction = row.direction;
  if (row.battery_percent != null) payload.battery_percent = row.battery_percent;
  if (typeof inferredHeading === 'boolean') payload.heading_toward_lipa = inferredHeading;
  const { error } = await supabase.from('tracker_reports').insert(payload);
  if (
    error &&
    error.code !== '42P01' &&
    error.code !== '42703' &&
    error.code !== 'PGRST204' &&
    error.code !== 'PGRST205'
  ) {
    throw error;
  }
}

async function getSupabaseClient(): Promise<{
  upsert: (row: TrackerReportRow, opts?: PersistTrackerReportOptions) => Promise<void>;
  getLatest: () => Promise<TrackerReportRow[]>;
} | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);
  return {
    async upsert(row: TrackerReportRow, opts?: PersistTrackerReportOptions) {
      let speedKmh = row.speed_kmh;
      const { data: prev } = await supabase
        .from('tracker_latest')
        .select('ingest_enabled, latitude, longitude, reported_at, position_percent, heading_toward_lipa, scrape_interval_ms')
        .eq('device_id', row.vehicle_id)
        .maybeSingle();

      if (prev && (prev as { ingest_enabled?: boolean }).ingest_enabled === false) {
        return;
      }

      // Idempotency only: drop reports that are not strictly newer than the
      // stored row (unless poller asks to refresh `updated_at` for unchanged GPS time).
      const prevReportedAt = prev && typeof (prev as { reported_at?: unknown }).reported_at === 'string'
        ? (prev as { reported_at: string }).reported_at
        : null;
      if (prevReportedAt && row.reported_at) {
        const previousReportedAtMs = new Date(prevReportedAt).getTime();
        const incomingReportedAtMs = new Date(row.reported_at).getTime();
        if (
          Number.isFinite(previousReportedAtMs) &&
          Number.isFinite(incomingReportedAtMs) &&
          incomingReportedAtMs <= previousReportedAtMs
        ) {
          if (opts?.touchUpdatedAtIfReportUnchanged) {
            await supabase
              .from('tracker_latest')
              .update({ updated_at: new Date().toISOString() })
              .eq('device_id', row.vehicle_id);
          }
          return;
        }
      }

      if (
        row.latitude != null &&
        row.longitude != null &&
        row.reported_at &&
        prev?.latitude != null &&
        prev?.longitude != null &&
        prev?.reported_at
      ) {
        const t1 = new Date(prev.reported_at).getTime();
        const t2 = new Date(row.reported_at).getTime();
        const computed = speedKmhFromPoints(
          prev.latitude,
          prev.longitude,
          t1,
          row.latitude,
          row.longitude,
          t2
        );
        if (computed >= 0) speedKmh = Math.round(computed * 10) / 10;
      }

      const prevRow = prev as { position_percent?: unknown; heading_toward_lipa?: boolean } | null;
      const prevHeading =
        prevRow?.heading_toward_lipa === true ? true : prevRow?.heading_toward_lipa === false ? false : undefined;
      const inferredHeading = inferHeadingTowardLipa(
        prevRow?.position_percent != null ? Number(prevRow.position_percent) : null,
        Number(row.position_percent),
        prevHeading
      );
      const headingForHistory =
        inferredHeading === true || inferredHeading === false ? inferredHeading : undefined;

      const status = row.status ?? 'online';
      const payload: Record<string, unknown> = {
        device_id: row.vehicle_id,
        speed_kmh: speedKmh,
        position_percent: row.position_percent,
        reported_at: row.reported_at,
        updated_at: new Date().toISOString(),
        status,
      };
      if (row.latitude != null) payload.latitude = row.latitude;
      if (row.longitude != null) payload.longitude = row.longitude;
      if (row.direction != null) payload.direction = row.direction;
      if (row.battery_percent != null) payload.battery_percent = row.battery_percent;
      if (typeof headingForHistory === 'boolean') payload.heading_toward_lipa = headingForHistory;
      let latestErr: { code?: string; message?: string; details?: string; hint?: string } | null = null;
      let payloadUsed = payload;
      for (let i = 0; i < TRACKER_LATEST_UPSERT_COLUMNS_TIERS.length; i++) {
        payloadUsed = projectPayloadByColumns(payload, TRACKER_LATEST_UPSERT_COLUMNS_TIERS[i]);
        const { error } = await supabase.from('tracker_latest').upsert(payloadUsed, { onConflict: 'device_id' });
        latestErr = error;
        if (!latestErr) break;
        if (!isTrackerLatestUpsertRetryable(latestErr)) break;
      }
      if (!latestErr) {
        await insertTrackerReportHistoryRow(supabase, row, speedKmh, headingForHistory);
        await appendTrackerHistoryPoint(historySnapshotFromLatestPayload(row, payloadUsed));
        return;
      }
      if ((latestErr as { code?: string }).code === '42P01') {
        await insertTrackerReportHistoryRow(supabase, row, speedKmh, headingForHistory);
        await appendTrackerHistoryPoint({
          device_id: row.vehicle_id,
          vehicle_name: row.vehicle_name,
          latitude: row.latitude,
          longitude: row.longitude,
          speed_kmh: speedKmh,
          position_percent: Number(row.position_percent),
          reported_at: row.reported_at,
          status,
          direction: row.direction != null ? Number(row.direction) : undefined,
          battery_percent: row.battery_percent != null ? Number(row.battery_percent) : undefined,
          heading_toward_lipa: typeof headingForHistory === 'boolean' ? headingForHistory : undefined,
          stored_at: new Date().toISOString(),
        });
        return;
      }
      throw latestErr;
    },
    async getLatest() {
      let latestData: Record<string, unknown>[] | null = null;
      let latestErr: { code?: string; message?: string } | null = null;
      for (let i = 0; i < TRACKER_LATEST_SELECT_TIERS.length; i++) {
        const res = await supabase.from('tracker_latest').select(TRACKER_LATEST_SELECT_TIERS[i]);
        latestData = res.data as unknown as Record<string, unknown>[] | null;
        latestErr = res.error;
        if (!latestErr) break;
        if (!isTrackerLatestSelectRetryable(latestErr)) break;
      }
      if (!latestErr) {
        if (latestData?.length) {
          return latestData.map((raw): TrackerReportRow => {
            const r = raw as Record<string, unknown>;
            const h = r.heading_toward_lipa;
            const ie = r.ingest_enabled;
            const sim = r.scrape_interval_ms;
            return {
              vehicle_id: String(r.device_id ?? ''),
              vehicle_name: r.vehicle_name != null ? String(r.vehicle_name) : undefined,
              latitude: r.latitude != null ? Number(r.latitude) : undefined,
              longitude: r.longitude != null ? Number(r.longitude) : undefined,
              speed_kmh: Number(r.speed_kmh ?? 0),
              position_percent: Number(r.position_percent ?? 0),
              status: r.status === 'offline' ? 'offline' : 'online',
              reported_at: String(r.reported_at ?? ''),
              direction: r.direction != null ? Number(r.direction) : undefined,
              battery_percent: r.battery_percent != null ? Number(r.battery_percent) : undefined,
              heading_toward_lipa: h === true ? true : h === false ? false : undefined,
              ...(ie === false ? { ingest_enabled: false as const } : {}),
              ...(sim != null && Number.isFinite(Number(sim)) ? { scrape_interval_ms: Number(sim) } : {}),
            };
          });
        }
        // tracker_latest exists but has no rows — do not fall back to tracker_reports (often not created).
        return [];
      }
      const { data, error } = await supabase
        .from('tracker_reports')
        .select('vehicle_id, speed_kmh, position_percent, reported_at')
        .order('reported_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const byVehicle = new Map<string, TrackerReportRow & { vehicle_name?: string }>();
      for (const row of data ?? []) {
        const id = String(row.vehicle_id);
        if (!byVehicle.has(id)) {
          byVehicle.set(id, {
            vehicle_id: id,
            speed_kmh: row.speed_kmh,
            position_percent: row.position_percent,
            reported_at: row.reported_at,
          });
        }
      }
      return Array.from(byVehicle.values());
    },
  };
}

/** Persist one report (from Sinotrack ingest). Upserts to tracker_latest or inserts into tracker_reports; in-memory if no DB. Speed computed from previous (lat, long, timestamp) when available. */
export async function persistTrackerReport(
  report: TrackerReportRow,
  opts?: PersistTrackerReportOptions
): Promise<void> {
  const db = await getSupabaseClient();
  if (db) {
    await db.upsert(report, opts);
  } else {
    let speedKmh = report.speed_kmh;
    if (
      report.latitude != null &&
      report.longitude != null &&
      report.reported_at
    ) {
      const prev = memoryStore.get(report.vehicle_id);
      if (
        prev?.latitude != null &&
        prev?.longitude != null &&
        prev?.reported_at
      ) {
        const t1 = new Date(prev.reported_at).getTime();
        const t2 = new Date(report.reported_at).getTime();
        const computed = speedKmhFromPoints(
          prev.latitude,
          prev.longitude,
          t1,
          report.latitude,
          report.longitude,
          t2
        );
        if (computed >= 0) speedKmh = Math.round(computed * 10) / 10;
      }
    }
    const prevMem = memoryStore.get(report.vehicle_id);
    const prevH =
      prevMem?.heading_toward_lipa === true ? true : prevMem?.heading_toward_lipa === false ? false : undefined;
    const inferredMem = inferHeadingTowardLipa(
      prevMem?.position_percent != null ? Number(prevMem.position_percent) : null,
      Number(report.position_percent),
      prevH
    );
    memoryStore.set(report.vehicle_id, {
      ...report,
      speed_kmh: speedKmh,
      ...(typeof inferredMem === 'boolean' ? { heading_toward_lipa: inferredMem } : {}),
    });
    const mem = memoryStore.get(report.vehicle_id)!;
    await appendTrackerHistoryPoint({
      device_id: mem.vehicle_id,
      vehicle_name: mem.vehicle_name,
      latitude: mem.latitude,
      longitude: mem.longitude,
      speed_kmh: Number(mem.speed_kmh),
      position_percent: Number(mem.position_percent),
      reported_at: mem.reported_at,
      status: mem.status ?? 'online',
      direction: mem.direction != null ? Number(mem.direction) : undefined,
      battery_percent: mem.battery_percent != null ? Number(mem.battery_percent) : undefined,
      heading_toward_lipa:
        mem.heading_toward_lipa === true ? true : mem.heading_toward_lipa === false ? false : undefined,
      stored_at: new Date().toISOString(),
    });
  }
}

export type GetLatestResult = {
  vehicles: TrackerVehicle[];
  source: 'database' | 'fallback';
  /** Set when source is 'fallback' so API can expose why DB wasn't used (e.g. missing env or Supabase error). */
  error?: string;
};

/** Get latest state per vehicle from DB (or memory) with source/error for diagnostics. */
export async function getLatestVehiclesFromDbWithMeta(): Promise<GetLatestResult> {
  try {
    return await getLatestVehiclesFromDbWithMetaUnsafe();
  } catch (e) {
    return {
      vehicles: [],
      source: 'fallback',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function getLatestVehiclesFromDbWithMetaUnsafe(): Promise<GetLatestResult> {
  const db = await getSupabaseClient();
  let rows: TrackerReportRow[];
  let error: string | undefined;
  if (db) {
    try {
      rows = await db.getLatest();
    } catch (e) {
      rows = [];
      const err = e as Error & { message?: string; error?: string; details?: string };
      error = err?.message ?? err?.error ?? (typeof err === 'object' && err !== null ? JSON.stringify(err) : String(e));
    }
  } else {
    rows = Array.from(memoryStore.values());
    if (rows.length === 0) error = 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) not set';
  }

  if (rows.length === 0) {
    return {
      vehicles: [],
      source: error ? 'fallback' : 'database',
      ...(error ? { error } : {}),
    };
  }

  const fallback = getVehicles();
  const fallbackById = new Map(fallback.map((v) => [v.id, v]));
  const now = Date.now();

  type VehicleRowMeta = Pick<
    TrackerVehicle,
    'id' | 'plateNumber' | 'driver' | 'status' | 'passengers' | 'capacity' | 'trackerOnline'
  >;

  const vehicles: TrackerVehicle[] = rows.map((r) => {
    const fromFallback = fallbackById.get(r.vehicle_id);
    const fromRealRoster = getRealFleetDevice(r.vehicle_id);
    let meta: VehicleRowMeta =
      fromFallback != null
        ? {
            id: fromFallback.id,
            plateNumber: fromFallback.plateNumber,
            driver: fromFallback.driver,
            status: fromFallback.status,
            passengers: fromFallback.passengers,
            capacity: fromFallback.capacity,
            trackerOnline: fromFallback.trackerOnline,
          }
        : {
            id: r.vehicle_id,
            plateNumber: fromRealRoster?.deviceId ?? r.vehicle_id,
            driver: '—',
            status: 'online',
            passengers: 0,
            capacity: 20,
            trackerOnline: true,
          };
    if (fromFallback == null) {
      const hash = r.vehicle_id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      meta = { ...meta, passengers: 3 + (hash % 15) };
    }
    const name = r.vehicle_name;
    const plateNumber = typeof name === 'string' && name.trim() ? name.trim() : meta.plateNumber;
    const reportedAt = new Date(r.reported_at).getTime();
    const positionPercent =
      r.latitude != null && r.longitude != null && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
        ? latLngToPositionPercent(r.latitude, r.longitude)
        : r.position_percent;
    const trackerOnline = now - reportedAt < STALE_MS;
    const status = r.status === 'offline' || r.status === 'online' ? r.status : (trackerOnline ? 'online' : 'offline');
    const h = r.heading_toward_lipa;
    const towardLipa =
      resolveDirectionAlongRoute({
        headingTowardLipa: h === true ? true : h === false ? false : undefined,
        direction: r.direction != null && !Number.isNaN(Number(r.direction)) ? Number(r.direction) : undefined,
        currentPosition: positionPercent,
      }) === 'to_lipa';
    const remainingDistanceKm = distanceKmToRouteTerminus(positionPercent, towardLipa);
    const remainingDistancePercent = ROUTE_LENGTH_KM > 0 ? (remainingDistanceKm / ROUTE_LENGTH_KM) * 100 : 0;
    const eta = computeEtaInDirectionOfTravel(positionPercent, r.speed_kmh, towardLipa);
    const etaInDirectionOfTravel =
      eta.etaText === 'N/A' ? `N/A to ${eta.etaLabel}` : `${eta.etaText} to ${eta.etaLabel}`;
    return {
      id: meta.id,
      plateNumber,
      driver: meta.driver,
      currentPosition: positionPercent,
      speed: r.speed_kmh,
      status,
      passengers: meta.passengers,
      capacity: meta.capacity,
      trackerOnline,
      remainingDistancePercent,
      remainingDistanceKm,
      lastUpdated:
        typeof (r as unknown as { updated_at?: unknown }).updated_at === 'string' && (r as unknown as { updated_at: string }).updated_at.trim()
          ? (r as unknown as { updated_at: string }).updated_at
          : r.reported_at,
      ...(r.latitude != null && r.longitude != null ? { latitude: r.latitude, longitude: r.longitude } : {}),
      etaInDirectionOfTravel,
      ...(h === true || h === false ? { headingTowardLipa: h } : {}),
      ...(r.direction != null && !Number.isNaN(Number(r.direction)) ? { direction: Number(r.direction) } : {}),
      ingestEnabled: r.ingest_enabled !== false,
      ...(r.scrape_interval_ms != null && Number.isFinite(Number(r.scrape_interval_ms))
        ? { scrapeIntervalMs: Number(r.scrape_interval_ms) }
        : {}),
    };
  });

  const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
  for (const device of REAL_FLEET_ROSTER) {
    if (vehicleIds.has(device.deviceId)) continue;
    vehicles.push({
      id: device.deviceId,
      plateNumber: device.deviceId,
      driver: device.simNumber,
      currentPosition: 0,
      speed: 0,
      status: 'offline',
      passengers: 0,
      capacity: 20,
      trackerOnline: false,
      remainingDistancePercent: 0,
      remainingDistanceKm: 0,
      lastUpdated: '',
      etaInDirectionOfTravel: 'N/A to Batangas Grand Terminal',
      ingestEnabled: true,
    });
  }

  return { vehicles: sortByRealFleetRoster(vehicles), source: 'database' };
}

/** Get latest state per vehicle from DB (or memory). Falls back to simulated getVehicles() if empty. */
export async function getLatestVehiclesFromDb(): Promise<TrackerVehicle[] | null> {
  const { vehicles, source } = await getLatestVehiclesFromDbWithMeta();
  return source === 'database' ? vehicles : null;
}

export async function getTrackerHistoryFromDb(
  deviceId: string,
  limit = 100
): Promise<{ points: TrackerHistoryPoint[]; source: 'database' | 'memory' | 'unavailable'; error?: string }> {
  const cappedLimit = Math.max(1, Math.min(500, Math.round(limit) || 100));
  const db = await getSupabaseClient();
  if (db) {
    try {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
      if (!url || !key) return { points: [], source: 'unavailable', error: 'Supabase env not configured' };
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(url, key);

      const reportSelectTiers = [
        'vehicle_id, latitude, longitude, speed_kmh, position_percent, reported_at, status, direction, battery_percent, heading_toward_lipa, created_at',
        'vehicle_id, latitude, longitude, speed_kmh, position_percent, reported_at, status, direction, battery_percent, created_at',
        'vehicle_id, latitude, longitude, speed_kmh, position_percent, reported_at, status, created_at',
        'vehicle_id, speed_kmh, position_percent, reported_at, created_at',
      ] as const;

      for (const fields of reportSelectTiers) {
        const res = await supabase
          .from('tracker_reports')
          .select(fields)
          .eq('vehicle_id', deviceId)
          .order('reported_at', { ascending: false })
          .limit(cappedLimit);
        if (!res.error) {
          const rawRows = (res.data ?? []) as unknown as Record<string, unknown>[];
          const points = rawRows.map((row) => {
            const record = row;
            return {
              device_id: String(record.vehicle_id ?? deviceId),
              latitude: record.latitude != null ? Number(record.latitude) : undefined,
              longitude: record.longitude != null ? Number(record.longitude) : undefined,
              speed_kmh: record.speed_kmh != null ? Number(record.speed_kmh) : 0,
              position_percent: record.position_percent != null ? Number(record.position_percent) : 0,
              reported_at: String(record.reported_at ?? new Date().toISOString()),
              status: record.status === 'offline' ? 'offline' : 'online',
              direction: record.direction != null ? Number(record.direction) : undefined,
              battery_percent: record.battery_percent != null ? Number(record.battery_percent) : undefined,
              heading_toward_lipa:
                record.heading_toward_lipa === true
                  ? true
                  : record.heading_toward_lipa === false
                    ? false
                    : undefined,
              stored_at: String(record.created_at ?? record.reported_at ?? new Date().toISOString()),
            } satisfies TrackerHistoryPoint;
          });
          if (points.length > 0) return { points, source: 'database' };
          break;
        }
        if (!isTrackerLatestSelectRetryable(res.error)) break;
      }

      const latestRes = await supabase
        .from('tracker_latest')
        .select(
          'device_id, vehicle_name, latitude, longitude, speed_kmh, position_percent, reported_at, status, direction, battery_percent, heading_toward_lipa, updated_at'
        )
        .eq('device_id', deviceId)
        .maybeSingle();
      if (!latestRes.error && latestRes.data) {
        const row = latestRes.data as Record<string, unknown>;
        return {
          points: [
            {
              device_id: String(row.device_id ?? deviceId),
              vehicle_name: row.vehicle_name != null ? String(row.vehicle_name) : undefined,
              latitude: row.latitude != null ? Number(row.latitude) : undefined,
              longitude: row.longitude != null ? Number(row.longitude) : undefined,
              speed_kmh: row.speed_kmh != null ? Number(row.speed_kmh) : 0,
              position_percent: row.position_percent != null ? Number(row.position_percent) : 0,
              reported_at: String(row.reported_at ?? new Date().toISOString()),
              status: row.status === 'offline' ? 'offline' : 'online',
              direction: row.direction != null ? Number(row.direction) : undefined,
              battery_percent: row.battery_percent != null ? Number(row.battery_percent) : undefined,
              heading_toward_lipa:
                row.heading_toward_lipa === true ? true : row.heading_toward_lipa === false ? false : undefined,
              stored_at: String(row.updated_at ?? row.reported_at ?? new Date().toISOString()),
            },
          ],
          source: 'database',
        };
      }
      return { points: [], source: 'unavailable', error: latestRes.error?.message };
    } catch (e) {
      return {
        points: [],
        source: 'unavailable',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const points = memoryStore.get(deviceId)
    ? [
        {
          device_id: deviceId,
          vehicle_name: memoryStore.get(deviceId)?.vehicle_name,
          latitude: memoryStore.get(deviceId)?.latitude,
          longitude: memoryStore.get(deviceId)?.longitude,
          speed_kmh: Number(memoryStore.get(deviceId)?.speed_kmh ?? 0),
          position_percent: Number(memoryStore.get(deviceId)?.position_percent ?? 0),
          reported_at: String(memoryStore.get(deviceId)?.reported_at ?? new Date().toISOString()),
          status: memoryStore.get(deviceId)?.status ?? 'online',
          direction:
            memoryStore.get(deviceId)?.direction != null ? Number(memoryStore.get(deviceId)?.direction) : undefined,
          battery_percent:
            memoryStore.get(deviceId)?.battery_percent != null
              ? Number(memoryStore.get(deviceId)?.battery_percent)
              : undefined,
          heading_toward_lipa:
            memoryStore.get(deviceId)?.heading_toward_lipa === true
              ? true
              : memoryStore.get(deviceId)?.heading_toward_lipa === false
                ? false
                : undefined,
          stored_at: new Date().toISOString(),
        } satisfies TrackerHistoryPoint,
      ]
    : [];
  return { points, source: points.length > 0 ? 'memory' : 'unavailable' };
}
