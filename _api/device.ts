/**
 * Flespi HTTP stream → same persistence as /api/ingest.
 * Flespi POSTs a JSON array of messages with dotted keys, e.g.:
 * [{ "ident": "...", "position.latitude": 1, "position.longitude": 2, "timestamp": 1650636570.42 }]
 *
 * POST /api/device
 */

import type { SinotrackReportInput } from '../src/lib/server/sinotrack-types';
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

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

/** Flespi uses flat keys like "position.latitude" on the message object. */
function flespiMessageToInput(raw: Record<string, unknown>): SinotrackReportInput | null {
  const ident = typeof raw.ident === 'string' ? raw.ident.trim() : '';
  if (!ident) return null;

  const lat = num(raw['position.latitude']);
  const lng = num(raw['position.longitude']);
  if (lat == null || lng == null) return null;

  const ts = raw.timestamp ?? raw['server.timestamp'];
  let reported_at: string | number | undefined;
  if (typeof ts === 'number') {
    // Flespi usually sends Unix seconds (with fraction); JS Date wants ms.
    reported_at = ts < 1e12 ? Math.round(ts * 1000) : Math.round(ts);
  } else if (typeof ts === 'string' && ts.trim() !== '') {
    reported_at = ts;
  }

  const speed =
    num(raw['position.speed']) ??
    num(raw.speed) ??
    num(raw['engine.speed']);

  const direction =
    num(raw['position.direction']) ?? num(raw.direction) ?? num(raw['gps.direction']);

  const bat =
    num(raw['battery.level']) ??
    num(raw['battery.percent']) ??
    num(raw['custom.battery.percent']);

  return {
    imei: ident,
    device_id: ident,
    lat,
    lng,
    ...(reported_at != null ? { reported_at } : {}),
    ...(speed != null ? { speed_kmh: speed } : {}),
    ...(direction != null ? { direction } : {}),
    ...(bat != null ? { battery_percent: bat } : {}),
  };
}

export async function POST(request: Request) {
  if (request.headers.get('content-type')?.includes('application/json') === false) {
    return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const messages: Record<string, unknown>[] = Array.isArray(body)
    ? (body as Record<string, unknown>[])
    : body && typeof body === 'object' && Array.isArray((body as { messages?: unknown }).messages)
      ? ((body as { messages: Record<string, unknown>[] }).messages ?? [])
      : [];

  const reports = messages
    .map((m) => flespiMessageToInput(m))
    .filter((r): r is SinotrackReportInput => r != null);

  const normalized = reports
    .map((r) => normalizeSinotrackReport(r))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Flespi waits for 2xx before sending the next batch; 400 can stall the stream on heartbeats / non-position messages.
  if (normalized.length === 0) {
    return new Response(JSON.stringify({ ok: true, inserted: 0, skipped: messages.length }), {
      status: 200,
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
