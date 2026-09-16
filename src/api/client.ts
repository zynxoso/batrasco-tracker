/**
 * API client for tracker/vehicle data (Sinotrack-style backend).
 * POST /api/trackers-poll is triggered every 5s from the dashboard; GET /api/vehicles
 * is scheduled from X-Fleet-Data-At + 15s (see App.tsx scheduleNextVehicleFetch).
 */

export type VehicleStatus = 'online' | 'offline';

export type VehicleFromApi = {
  id: string;
  plateNumber: string;
  driver: string;
  currentPosition: number;
  /** Speed in km/h (computed from lat/long/timestamp when not sent by device) */
  speed: number;
  status: VehicleStatus;
  passengers: number;
  capacity: number;
  trackerOnline: boolean;
  remainingDistancePercent: number;
  remainingDistanceKm: number;
  /** Server ingest time (`tracker_latest.updated_at`), not GPS `reported_at`. */
  lastUpdated: string;
  /** Tracker position (for distance to station) */
  latitude?: number;
  longitude?: number;
  /** Single ETA in direction of travel, e.g. "12 min to Batangas Grand Terminal" */
  etaInDirectionOfTravel?: string;
  /** true = toward Lipa (100%), false = toward Batangas (0%); from DB when present. */
  headingTowardLipa?: boolean;
  /** Direction of travel from device (e.g. degrees 0–360). From hardware. */
  direction?: number;
  /** Battery level 0–100. From hardware. */
  batteryPercent?: number;
  /** When false, /api/ingest ignores new points for this device (poller can still run). */
  ingestEnabled?: boolean;
  /** Optional per-device scrape interval in ms. */
  scrapeIntervalMs?: number;
};

const INGEST_TOGGLE_URL = '/api/vehicle-ingest-toggle';
const SCRAPE_INTERVAL_URL = '/api/vehicle-scrape-interval';
const CRON_TRACKING_TOGGLE_URL = '/api/cron-tracking-toggle';
const TRACKERS_POLL_URL = '/api/trackers-poll';

export type TriggerTrackersPollResult = {
  ok: boolean;
  status: number;
  cronEnabled?: boolean;
  polled?: number;
  errored?: number;
  skipped?: number;
  error?: string;
};

/**
 * Fire-and-forget trigger for the SinoTrack scraper. The dashboard fires this
 * every 5s while the tab is visible. With KV configured, the server runs one
 * fleet-wide parallel scrape at most every TRACKER_GLOBAL_POLL_INTERVAL_MS (see `_api/trackers-poll.ts`).
 */
export async function triggerTrackersPoll(): Promise<TriggerTrackersPollResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const viteSecret = import.meta.env.VITE_TRACKER_POLL_SECRET;
  if (typeof viteSecret === 'string' && viteSecret) {
    headers['X-Tracker-Poll-Secret'] = viteSecret;
  }
  try {
    const res = await fetch(TRACKERS_POLL_URL, {
      method: 'POST',
      headers,
      body: '{}',
      cache: 'no-store',
    });
    const text = await res.text();
    let j: {
      ok?: boolean;
      cron_tracking_enabled?: boolean;
      polled?: number;
      errored?: number;
      skipped?: number;
      error?: string;
    } = {};
    try {
      j = JSON.parse(text) as typeof j;
    } catch {
      return { ok: false, status: res.status, error: text.slice(0, 200) };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: j.error || `HTTP ${res.status}` };
    }
    return {
      ok: j.ok !== false,
      status: res.status,
      cronEnabled: j.cron_tracking_enabled,
      polled: j.polled,
      errored: j.errored,
      skipped: j.skipped,
    };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export type CronTrackingState = {
  ok: boolean;
  enabled: boolean;
  source: 'kv' | 'default';
  reason?: string;
  error?: string;
};

export async function fetchCronTrackingEnabled(): Promise<CronTrackingState> {
  try {
    const res = await fetch(CRON_TRACKING_TOGGLE_URL, { cache: 'no-store' });
    const text = await res.text();
    let j: Partial<CronTrackingState> & { error?: string };
    try {
      j = JSON.parse(text) as Partial<CronTrackingState> & { error?: string };
    } catch {
      return { ok: false, enabled: true, source: 'default', error: text.slice(0, 200) };
    }
    if (!res.ok) {
      return {
        ok: false,
        enabled: j.enabled ?? true,
        source: j.source ?? 'default',
        error: j.error || `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      enabled: j.enabled !== false,
      source: j.source ?? 'default',
      ...(j.reason ? { reason: j.reason } : {}),
    };
  } catch (e) {
    return {
      ok: false,
      enabled: true,
      source: 'default',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function setCronTrackingEnabled(enabled: boolean): Promise<CronTrackingState> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const viteSecret = import.meta.env.VITE_VEHICLE_INGEST_TOGGLE_SECRET;
  if (typeof viteSecret === 'string' && viteSecret) {
    headers['X-Vehicle-Ingest-Toggle-Secret'] = viteSecret;
  }
  try {
    const res = await fetch(CRON_TRACKING_TOGGLE_URL, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ enabled }),
    });
    const text = await res.text();
    let j: Partial<CronTrackingState> & { error?: string };
    try {
      j = JSON.parse(text) as Partial<CronTrackingState> & { error?: string };
    } catch {
      return { ok: false, enabled, source: 'default', error: text.slice(0, 200) };
    }
    if (!res.ok) {
      return {
        ok: false,
        enabled: j.enabled ?? enabled,
        source: j.source ?? 'default',
        error: j.error || `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      enabled: j.enabled !== false,
      source: j.source ?? 'default',
      ...(j.reason ? { reason: j.reason } : {}),
    };
  } catch (e) {
    return {
      ok: false,
      enabled,
      source: 'default',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Optional browser-exposed secret (weak); prefer server-only VEHICLE_INGEST_TOGGLE_SECRET + proxy. */
export async function setVehicleIngestEnabled(
  deviceId: string,
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const viteSecret = import.meta.env.VITE_VEHICLE_INGEST_TOGGLE_SECRET;
  if (typeof viteSecret === 'string' && viteSecret) {
    headers['X-Vehicle-Ingest-Toggle-Secret'] = viteSecret;
  }
  const res = await fetch(INGEST_TOGGLE_URL, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ device_id: deviceId, enabled }),
  });
  const text = await res.text();
  let j: { ok?: boolean; error?: string };
  try {
    j = JSON.parse(text) as { ok?: boolean; error?: string };
  } catch {
    return { ok: false, error: text.slice(0, 200) };
  }
  if (!res.ok) return { ok: false, error: j.error || `HTTP ${res.status}` };
  return { ok: j.ok !== false };
}

export async function setVehicleScrapeIntervalMs(
  deviceId: string,
  intervalMs: number
): Promise<{ ok: boolean; error?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const viteSecret = import.meta.env.VITE_VEHICLE_INGEST_TOGGLE_SECRET;
  if (typeof viteSecret === 'string' && viteSecret) {
    headers['X-Vehicle-Ingest-Toggle-Secret'] = viteSecret;
  }
  const res = await fetch(SCRAPE_INTERVAL_URL, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ device_id: deviceId, scrape_interval_ms: intervalMs }),
  });
  const text = await res.text();
  let j: { ok?: boolean; error?: string };
  try {
    j = JSON.parse(text) as { ok?: boolean; error?: string };
  } catch {
    return { ok: false, error: text.slice(0, 200) };
  }
  if (!res.ok) return { ok: false, error: j.error || `HTTP ${res.status}` };
  return { ok: j.ok !== false };
}

/** Same-origin `/api` — in dev, set `VITE_API_PROXY_ORIGIN` in `.env.local` so Vite proxies to your deployed app. */
const VEHICLES_URL = '/api/vehicles';

export type FetchVehiclesResult = {
  data: VehicleFromApi[] | null;
  etag: string;
  /** When API returns 200, from response header (database | fallback). */
  source?: string;
  /** When API returns 200 but no data, from response header (reason). */
  error?: string;
  /** True when API returned 304 Not Modified — keep existing UI state; do not fall back to Supabase. */
  notModified?: boolean;
  /** From X-Fleet-Data-At (Unix ms); max(KV last persist, DB max `lastUpdated`). */
  lastFleetDataAtMs?: number | null;
};

function parseFleetDataAtHeader(value: string | null): number | null {
  if (value == null || !String(value).trim()) return null;
  const trimmed = String(value).trim();
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum > 0) return asNum;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function fetchVehicles(previousEtag?: string): Promise<FetchVehiclesResult> {
  const headers: HeadersInit = { cache: 'no-store' };
  if (previousEtag) headers['If-None-Match'] = previousEtag;
  let res: Response;
  try {
    res = await fetch(VEHICLES_URL, { headers });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${cause} (${VEHICLES_URL}). Network error: check that the dev or preview server is running; if VITE_API_PROXY_ORIGIN is set, the target must be reachable over HTTPS.`
    );
  }
  const etag = res.headers.get('ETag') ?? '';
  const source = res.headers.get('X-Vehicles-Source') ?? undefined;
  const error = res.headers.get('X-Vehicles-Error') ?? undefined;
  const lastFleetDataAtMs = parseFleetDataAtHeader(res.headers.get('X-Fleet-Data-At'));
  if (res.status === 304) {
    return { data: null, etag, source, error, notModified: true, lastFleetDataAtMs };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  const text = await res.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    const hint =
      text.trimStart().startsWith('import ')
        ? ' (dev server returned JS instead of JSON — set VITE_API_PROXY_ORIGIN to your deployed app, or rely on local Vite handling /api/vehicles as JSON when no proxy is set.)'
        : '';
    throw new Error(
      `API ${res.status}: not valid JSON${hint}: ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`
    );
  }
  const data = Array.isArray(raw) ? raw : null;
  return { data, etag, source, error, lastFleetDataAtMs };
}

const TRACKER_HISTORY_URL = '/api/tracker-history';

export type TrackerHistoryPointClient = {
  device_id: string;
  vehicle_name?: string;
  latitude?: number;
  longitude?: number;
  speed_kmh: number;
  position_percent: number;
  reported_at: string;
  status: string;
  direction?: number;
  battery_percent?: number;
  heading_toward_lipa?: boolean;
  stored_at: string;
};

export async function fetchTrackerHistory(
  deviceId: string,
  limit = 100
): Promise<{
  points: TrackerHistoryPointClient[];
  configured: boolean;
  message?: string;
  error?: string;
}> {
  const url = `${TRACKER_HISTORY_URL}?device_id=${encodeURIComponent(deviceId)}&limit=${limit}`;
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    return { points: [], configured: false, error: cause };
  }
  try {
    const j = (await res.json()) as {
      points?: TrackerHistoryPointClient[];
      configured?: boolean;
      message?: string;
      error?: string;
    };
    if (!res.ok) {
      return {
        points: [],
        configured: j.configured ?? false,
        message: j.message,
        error: j.error || `HTTP ${res.status}`,
      };
    }
    return {
      points: Array.isArray(j.points) ? j.points : [],
      configured: j.configured === true,
      message: j.message,
    };
  } catch {
    return { points: [], configured: false, error: 'Invalid JSON from tracker-history' };
  }
}
