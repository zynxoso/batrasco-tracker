import { requireAdmin } from '../src/lib/server/access';
import { nodeHandler } from '../src/lib/server/http-handler';
/**
 * GET   /api/cron-tracking-toggle  → { ok, enabled, source, reason? }
 * PATCH /api/cron-tracking-toggle  → body: { enabled: boolean } → same shape
 *
 * Backed by Vercel KV. Reuses VEHICLE_INGEST_TOGGLE_SECRET so the dashboard
 * can use the same `X-Vehicle-Ingest-Toggle-Secret` header that already
 * authenticates the per-device toggle endpoints.
 */

import { getCronTrackingEnabled, setCronTrackingEnabled } from '../src/lib/server/cron-state';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const denied = await requireAdmin(request); if (denied) return denied;
  const state = await getCronTrackingEnabled();
  return jsonResponse(200, { ok: true, ...state });
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin(request); if (denied) return denied;

  let body: { enabled?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown };
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON' });
  }

  if (typeof body.enabled !== 'boolean') {
    return jsonResponse(400, { ok: false, error: 'Need enabled (boolean)' });
  }

  try {
    const state = await setCronTrackingEnabled(body.enabled);
    return jsonResponse(200, { ok: true, ...state });
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export default nodeHandler({OPTIONS, GET, PATCH});
