/**
 * Sinotrack input processing.
 * POST /api/ingest – receives tracker reports from Sinotrack (or gateway)
 * and inserts them into the database.
 *
 * This is the file that processes Sinotrack inputs.
 */

import { normalizeSinotrackReport } from '../src/lib/server/sinotrack-types';
import { persistTrackerReport } from '../src/lib/server/tracker-db';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const x = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts = [x.code, x.message, x.details, x.hint]
      .filter((v) => typeof v === 'string' && v.trim() !== '')
      .map((v) => String(v).trim());
    if (parts.length > 0) return parts.join(' | ');
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

export async function POST(request: Request) {
  if (request.headers.get('content-type')?.includes('application/json') === false) {
    return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  let body: {
    reports?: unknown[];
    device_id?: string;
    imei?: string;
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
    reported_at?: string | number;
    direction?: number | string;
    battery_percent?: number;
    status?: 'online' | 'offline';
    position_percent?: number;
    speed_kmh?: number;
    speed?: number;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const single =
    body.device_id != null || body.imei != null
      ? {
          device_id: body.device_id,
          imei: body.imei,
          lat: body.lat,
          lng: body.lng,
          latitude: body.latitude,
          longitude: body.longitude,
          reported_at: body.reported_at,
          direction: body.direction,
          battery_percent: body.battery_percent,
          status: body.status,
          position_percent: body.position_percent,
          speed_kmh: body.speed_kmh,
          speed: body.speed,
        }
      : null;
  const reports = Array.isArray(body.reports) ? body.reports : single ? [single] : [];

  const normalized = reports
    .map((r) => normalizeSinotrackReport(r as Parameters<typeof normalizeSinotrackReport>[0]))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (normalized.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid reports (need device_id or imei per report)', inserted: 0 }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  try {
    for (const row of normalized) {
      await persistTrackerReport(row);
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Database error', message: describeError(e), inserted: 0 }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  return new Response(JSON.stringify({ ok: true, inserted: normalized.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
