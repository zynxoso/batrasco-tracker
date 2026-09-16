/**
 * Rolling GPS/status history on Vercel KV (Redis).
 * Written when /api/ingest successfully updates tracker state (same rules as DB ingest toggle).
 * Read via GET /api/tracker-history — no Supabase involved.
 *
 * Setup: Vercel → Storage / Marketplace → Redis (Upstash) → link to project.
 * Env is usually KV_REST_API_URL + KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 */

const HISTORY_KEY_PREFIX = 'tracker:hist:v1:';
const MAX_POINTS_PER_DEVICE = 500;

export type TrackerHistoryPoint = {
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
  /** Server receipt time (ISO). */
  stored_at: string;
};

function kvUrl(): string | undefined {
  return process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
}

function kvToken(): string | undefined {
  return process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
}

export function isTrackerHistoryKvConfigured(): boolean {
  return Boolean(kvUrl() && kvToken());
}

async function getKvRaw() {
  const url = kvUrl();
  const token = kvToken();
  if (!url || !token) return null;
  const { createClient } = await import('@vercel/kv');
  return createClient({
    url,
    token,
    automaticDeserialization: false,
  });
}

function historyRedisKey(deviceId: string): string {
  const safe = deviceId.replace(/[^a-zA-Z0-9:_-]/g, '_');
  return `${HISTORY_KEY_PREFIX}${safe}`;
}

/**
 * Best-effort: never throws (ingest must not fail because KV is down).
 */
export async function appendTrackerHistoryPoint(point: TrackerHistoryPoint): Promise<void> {
  const kv = await getKvRaw();
  if (!kv) return;
  try {
    const key = historyRedisKey(point.device_id);
    const serialized = JSON.stringify(point);
    await kv.lpush(key, serialized);
    await kv.ltrim(key, 0, MAX_POINTS_PER_DEVICE - 1);
  } catch (e) {
    console.warn('[tracker-history-kv] append failed:', e instanceof Error ? e.message : e);
  }
}

export async function getTrackerHistory(deviceId: string, limit: number): Promise<TrackerHistoryPoint[]> {
  const kv = await getKvRaw();
  if (!kv) return [];
  const cap = Math.min(Math.max(1, limit), MAX_POINTS_PER_DEVICE);
  try {
    const raw = await kv.lrange(historyRedisKey(deviceId), 0, cap - 1);
    const out: TrackerHistoryPoint[] = [];
    for (const item of raw) {
      try {
        const s = typeof item === 'string' ? item : JSON.stringify(item);
        out.push(JSON.parse(s) as TrackerHistoryPoint);
      } catch {
        // skip corrupt entries
      }
    }
    return out;
  } catch (e) {
    console.warn('[tracker-history-kv] read failed:', e instanceof Error ? e.message : e);
    return [];
  }
}
