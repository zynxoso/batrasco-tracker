/**
 * POST /api/trackers-poll
 *
 * Stateless cron endpoint for n8n (or any scheduler). On each invocation:
 *   1. Loads `tracker_latest` (device_id, reported_at, scrape_interval_ms, ingest_enabled).
 *   2. When Vercel KV is configured: one fleet-wide batch every `TRACKER_GLOBAL_POLL_INTERVAL_MS`
 *      (default 5000 ms) — all ingest-enabled devices are scraped in parallel on the same tick.
 *      Otherwise (no KV): per-device due = reported_at + scrape_interval_ms (fallback default 20s).
 *   3. Each job logs into SinoTrack as that user and calls Proc_GetLastPosition
 *      (shared password defaults to "12345" — override via SINOTRACK_SHARED_PASSWORD).
 *   4. Persists each report through the same path as /api/ingest (tracker_latest upsert + history);
 *      `updated_at` reflects the scrape time even when GPS `reported_at` is unchanged.
 *   5. Returns a per-device summary so n8n can show what happened.
 *
 * Auth: two accepted modes (either one passes; if neither env var is set the endpoint is open):
 *   1. n8n / external scheduler — set TRACKER_POLL_SECRET in Vercel and send header
 *      `x-tracker-poll-secret: <secret>`.
 *   2. Vercel Cron — set CRON_SECRET in Vercel; Vercel automatically attaches
 *      `Authorization: Bearer <CRON_SECRET>` to cron-triggered invocations.
 *
 * Body (all optional):
 *   {
 *     "device_ids": ["7026270707", ...],   // restrict to a subset; default = full fleet roster
 *     "force": true,                         // ignore global / due-time gating
 *     "default_interval_ms": 20000         // legacy (no KV): fallback scrape_interval_ms
 *   }
 */

import {
  getLastGlobalTrackerPollAt,
  isFleetKvConfigured,
  setLastFleetDataAt,
  setLastGlobalTrackerPollAt,
} from '../src/lib/server/fleet-data-clock';
import { getCronTrackingEnabled } from '../src/lib/server/cron-state';
import { REAL_FLEET_ROSTER } from '../src/lib/server/real-fleet-roster';
import { pollSinotrackUserPositions, type SinotrackPollPosition } from '../src/lib/server/sinotrack-poll';
import { normalizeSinotrackReport } from '../src/lib/server/sinotrack-types';
import { persistTrackerReport } from '../src/lib/server/tracker-db';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tracker-Poll-Secret',
};

const DEFAULT_INTERVAL_MS = 20_000;

/** When KV is set, minimum spacing between fleet-wide parallel scrapes (ms). */
const GLOBAL_POLL_INTERVAL_MS = (() => {
  const raw = Number(process.env.TRACKER_GLOBAL_POLL_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 500 && raw <= 120_000 ? Math.round(raw) : 5_000;
})();

type LatestRow = {
  device_id: string;
  reported_at: string | null;
  scrape_interval_ms: number | null;
  ingest_enabled: boolean | null;
};

type PerDeviceResult = {
  device_id: string;
  status: 'polled' | 'skipped' | 'error';
  reason?: string;
  next_due_at?: string;
  reports?: number;
};

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

async function loadTrackerLatest(): Promise<{ rows: Map<string, LatestRow>; error?: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { rows: new Map(), error: 'SUPABASE env not configured' };

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('tracker_latest')
    .select('device_id, reported_at, scrape_interval_ms, ingest_enabled');
  if (error) return { rows: new Map(), error: error.message };
  const out = new Map<string, LatestRow>();
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const id = String(raw.device_id ?? '').trim();
    if (!id) continue;
    out.set(id, {
      device_id: id,
      reported_at: typeof raw.reported_at === 'string' ? raw.reported_at : null,
      scrape_interval_ms:
        raw.scrape_interval_ms != null && Number.isFinite(Number(raw.scrape_interval_ms))
          ? Number(raw.scrape_interval_ms)
          : null,
      ingest_enabled: typeof raw.ingest_enabled === 'boolean' ? raw.ingest_enabled : null,
    });
  }
  return { rows: out };
}

function isDue(row: LatestRow | undefined, now: number, defaultIntervalMs: number): { due: boolean; nextDueAt: number } {
  const interval = row?.scrape_interval_ms && row.scrape_interval_ms > 0 ? row.scrape_interval_ms : defaultIntervalMs;
  const last = row?.reported_at ? new Date(row.reported_at).getTime() : 0;
  const nextDueAt = Number.isFinite(last) && last > 0 ? last + interval : 0;
  return { due: now >= nextDueAt, nextDueAt };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  const pollSecret = process.env.TRACKER_POLL_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const userAgent = (request.headers.get('user-agent') ?? '').toLowerCase();
  const looksLikeVercelCron = userAgent.startsWith('vercel-cron/');
  if (pollSecret || cronSecret) {
    const headerSecret = request.headers.get('x-tracker-poll-secret');
    const bearer = request.headers.get('authorization');
    const bearerSecret = bearer && bearer.startsWith('Bearer ') ? bearer.slice('Bearer '.length).trim() : null;
    const okPollSecret = pollSecret ? headerSecret === pollSecret : false;
    const okCronSecret = cronSecret ? bearerSecret === cronSecret : false;
    // Vercel Cron passes through the platform with a stable user-agent. When the
    // operator hasn't set CRON_SECRET we still want those scheduled invocations
    // to succeed — otherwise the cron silently 403s and looks "broken".
    if (!okPollSecret && !okCronSecret && !(looksLikeVercelCron && !cronSecret)) {
      return jsonResponse(403, { ok: false, error: 'Forbidden' });
    }
  }

  const cronState = await getCronTrackingEnabled();
  if (!cronState.enabled) {
    return jsonResponse(200, {
      ok: true,
      cron_tracking_enabled: false,
      cron_tracking_source: cronState.source,
      ...(cronState.reason ? { cron_tracking_reason: cronState.reason } : {}),
      now: new Date().toISOString(),
      polled: 0,
      errored: 0,
      skipped: 0,
      message: 'Cron tracking is disabled via global toggle. No devices were polled.',
      devices: [],
    });
  }

  let body: { device_ids?: unknown; force?: unknown; default_interval_ms?: unknown } = {};
  if (request.method === 'POST') {
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return jsonResponse(400, { ok: false, error: 'Invalid JSON body' });
      }
    }
  }

  const force = body.force === true;
  const defaultIntervalMs =
    typeof body.default_interval_ms === 'number' && body.default_interval_ms > 0
      ? Math.round(body.default_interval_ms)
      : DEFAULT_INTERVAL_MS;
  const requestedIds = Array.isArray(body.device_ids)
    ? new Set(body.device_ids.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()))
    : null;

  const fleet = REAL_FLEET_ROSTER.filter((d) => (requestedIds ? requestedIds.has(d.deviceId) : true));
  if (fleet.length === 0) {
    return jsonResponse(400, { ok: false, error: 'No matching devices in REAL_FLEET_ROSTER' });
  }

  const password = process.env.SINOTRACK_SHARED_PASSWORD || '12345';
  const serverUrl = process.env.SINOTRACK_APPJSON_SERVER || 'https://246.sinotrack.com';
  const pageOrigin = process.env.SINOTRACK_APPJSON_ORIGIN || 'https://pro.sinotrack.com';
  const loginType = (() => {
    const n = Number(process.env.SINOTRACK_APPJSON_LOGIN_TYPE);
    return n === 1 || n === 2 ? n : 0;
  })();

  const now = Date.now();
  const { rows: latest, error: loadError } = await loadTrackerLatest();
  const useGlobalFleetPoll = isFleetKvConfigured();

  type Job = { device_id: string; user: string; nextDueAt: number };
  const jobs: Job[] = [];
  const skipped: PerDeviceResult[] = [];

  for (const device of fleet) {
    const row = latest.get(device.deviceId);
    if (row?.ingest_enabled === false) {
      skipped.push({ device_id: device.deviceId, status: 'skipped', reason: 'ingest_enabled=false' });
      continue;
    }
    if (useGlobalFleetPoll) {
      jobs.push({ device_id: device.deviceId, user: device.deviceId, nextDueAt: 0 });
      continue;
    }
    const { due, nextDueAt } = isDue(row, now, defaultIntervalMs);
    if (!force && !due) {
      skipped.push({
        device_id: device.deviceId,
        status: 'skipped',
        reason: 'not due',
        next_due_at: new Date(nextDueAt).toISOString(),
      });
      continue;
    }
    jobs.push({ device_id: device.deviceId, user: device.deviceId, nextDueAt });
  }

  if (useGlobalFleetPoll && !force && jobs.length > 0) {
    const lastGlobal = await getLastGlobalTrackerPollAt();
    if (lastGlobal != null && now - lastGlobal < GLOBAL_POLL_INTERVAL_MS) {
      return jsonResponse(200, {
        ok: true,
        global_poll_throttled: true,
        global_poll_interval_ms: GLOBAL_POLL_INTERVAL_MS,
        now: new Date(now).toISOString(),
        fleet_size: fleet.length,
        polled: 0,
        errored: 0,
        skipped: skipped.length,
        deferred_poll_devices: jobs.length,
        default_interval_ms: defaultIntervalMs,
        forced: force,
        triggered_by: looksLikeVercelCron ? 'vercel-cron' : request.method,
        cron_tracking_enabled: cronState.enabled,
        cron_tracking_source: cronState.source,
        ...(cronState.reason ? { cron_tracking_reason: cronState.reason } : {}),
        ...(loadError ? { tracker_latest_load_error: loadError } : {}),
        devices: skipped,
      });
    }
  }

  if (useGlobalFleetPoll && jobs.length > 0) {
    await setLastGlobalTrackerPollAt(Date.now());
  }

  const pollOpts = { touchUpdatedAtIfReportUnchanged: true };
  const results = await Promise.all(
    jobs.map(async (job): Promise<PerDeviceResult> => {
      try {
        const positions: SinotrackPollPosition[] = await pollSinotrackUserPositions(job.user, password, {
          serverUrl,
          pageOrigin,
          loginType,
        });
        let inserted = 0;
        for (const pos of positions) {
          const normalized = normalizeSinotrackReport({
            device_id: pos.device_id,
            lat: pos.lat,
            lng: pos.lng,
            reported_at: pos.reported_at,
            ...(pos.direction != null ? { direction: pos.direction } : {}),
          });
          if (!normalized) continue;
          await persistTrackerReport(normalized, pollOpts);
          inserted++;
        }
        return { device_id: job.device_id, status: 'polled', reports: inserted };
      } catch (e) {
        return { device_id: job.device_id, status: 'error', reason: describeError(e) };
      }
    })
  );

  if (results.some((r) => (r.reports ?? 0) > 0)) {
    await setLastFleetDataAt(Date.now());
  }

  const summary = {
    ok: true,
    now: new Date(now).toISOString(),
    fleet_size: fleet.length,
    polled: results.filter((r) => r.status === 'polled').length,
    errored: results.filter((r) => r.status === 'error').length,
    skipped: skipped.length,
    ...(useGlobalFleetPoll
      ? { global_poll_interval_ms: GLOBAL_POLL_INTERVAL_MS, fleet_parallel_poll: true }
      : { fleet_parallel_poll: false }),
    default_interval_ms: defaultIntervalMs,
    forced: force,
    triggered_by: looksLikeVercelCron ? 'vercel-cron' : request.method,
    cron_tracking_enabled: cronState.enabled,
    cron_tracking_source: cronState.source,
    ...(cronState.reason ? { cron_tracking_reason: cronState.reason } : {}),
    ...(loadError ? { tracker_latest_load_error: loadError } : {}),
    devices: [...results, ...skipped],
  };
  return jsonResponse(200, summary);
}
