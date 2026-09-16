/**
 * Fleet-wide "last time tracker data was persisted" clock in Vercel KV.
 * Used with GET /api/vehicles header X-Fleet-Data-At (merged with DB max server `updated_at` via vehicles `lastUpdated`).
 */

const FLEET_DATA_AT_KEY = 'tracker:fleet_data_at:v1';
const GLOBAL_POLL_AT_KEY = 'tracker:last_global_poll_at:v1';

function kvUrl(): string | undefined {
  return process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
}

function kvToken(): string | undefined {
  return process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
}

async function getKv() {
  const url = kvUrl();
  const token = kvToken();
  if (!url || !token) return null;
  const { createClient } = await import('@vercel/kv');
  return createClient({ url, token, automaticDeserialization: false });
}

/** True when Vercel KV / Upstash env is set (used for fleet clock + global poll throttle). */
export function isFleetKvConfigured(): boolean {
  return Boolean(kvUrl() && kvToken());
}

/** Milliseconds since Unix epoch, or null if unset / KV unavailable. */
export async function getLastFleetDataAt(): Promise<number | null> {
  const kv = await getKv();
  if (!kv) return null;
  try {
    const raw = await kv.get(FLEET_DATA_AT_KEY);
    if (raw == null) return null;
    const n = Number(String(raw).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function setLastFleetDataAt(ms: number): Promise<void> {
  const kv = await getKv();
  if (!kv) return;
  try {
    await kv.set(FLEET_DATA_AT_KEY, String(Math.round(ms)));
  } catch {
    /* ignore */
  }
}

/** Last time `/api/trackers-poll` started a fleet-wide scrape batch (KV). */
export async function getLastGlobalTrackerPollAt(): Promise<number | null> {
  const kv = await getKv();
  if (!kv) return null;
  try {
    const raw = await kv.get(GLOBAL_POLL_AT_KEY);
    if (raw == null) return null;
    const n = Number(String(raw).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function setLastGlobalTrackerPollAt(ms: number): Promise<void> {
  const kv = await getKv();
  if (!kv) return;
  try {
    await kv.set(GLOBAL_POLL_AT_KEY, String(Math.round(ms)));
  } catch {
    /* ignore */
  }
}
