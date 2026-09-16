/**
 * Global cron tracking kill-switch.
 *
 * Stored in Vercel KV (Upstash Redis) under a single key. When the flag is
 * `false`, the `/api/trackers-poll` cron handler short-circuits without
 * touching SinoTrack — useful while debugging or if the upstream is rate
 * limiting. Default is enabled (true).
 *
 * Falls back gracefully when KV is not configured: the flag is treated as
 * `true` (cron runs as normal) and writes are no-ops.
 */

const KEY = 'tracker:cron:enabled:v1';

export type CronStateSource = 'kv' | 'default';

export type CronState = {
  enabled: boolean;
  source: CronStateSource;
  /** When source is 'default', the underlying reason (e.g. KV not configured). */
  reason?: string;
};

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

function parseStored(raw: unknown): boolean | null {
  if (raw == null) return null;
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).trim().toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return null;
}

export async function getCronTrackingEnabled(): Promise<CronState> {
  const kv = await getKv();
  if (!kv) {
    return { enabled: true, source: 'default', reason: 'KV not configured' };
  }
  try {
    const raw = await kv.get(KEY);
    const parsed = parseStored(raw);
    if (parsed === null) {
      return { enabled: true, source: 'default', reason: 'unset' };
    }
    return { enabled: parsed, source: 'kv' };
  } catch (e) {
    return {
      enabled: true,
      source: 'default',
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function setCronTrackingEnabled(enabled: boolean): Promise<CronState> {
  const kv = await getKv();
  if (!kv) {
    return { enabled: true, source: 'default', reason: 'KV not configured' };
  }
  await kv.set(KEY, enabled ? 'true' : 'false');
  return { enabled, source: 'kv' };
}
