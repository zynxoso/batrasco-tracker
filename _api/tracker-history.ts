/**
 * GET /api/tracker-history?device_id=…&limit=100
 * Returns recent ingest snapshots from Vercel KV / Upstash, with Supabase fallback.
 */

import { getTrackerHistory, isTrackerHistoryKvConfigured } from '../src/lib/server/tracker-history-kv';
import { getTrackerHistoryFromDb } from '../src/lib/server/tracker-db';

const CORS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get('device_id')?.trim();
  if (!deviceId) {
    return new Response(JSON.stringify({ error: 'device_id query parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw != null ? Number(limitRaw) : 100;

  if (!isTrackerHistoryKvConfigured()) {
    const fallback = await getTrackerHistoryFromDb(deviceId, Number.isFinite(limit) ? limit : 100);
    return new Response(
      JSON.stringify({
        device_id: deviceId,
        points: fallback.points,
        configured: fallback.source !== 'unavailable',
        source: fallback.source,
        count: fallback.points.length,
        message:
          fallback.points.length > 0
            ? 'Using database-backed history fallback.'
            : 'KV not configured and no database history found. Add Redis (Upstash) to Vercel or persist tracker_reports in Supabase.',
        ...(fallback.error ? { error: fallback.error } : {}),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }

  const points = await getTrackerHistory(deviceId, Number.isFinite(limit) ? limit : 100);

  return new Response(
    JSON.stringify({
      device_id: deviceId,
      points,
      configured: true,
      source: 'kv',
      count: points.length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
  );
}
