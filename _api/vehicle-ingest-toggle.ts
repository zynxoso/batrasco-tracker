/**
 * PATCH /api/vehicle-ingest-toggle
 * Body: { "device_id": "<imei>", "enabled": true | false }
 * Optional: header X-Vehicle-Ingest-Toggle-Secret when VEHICLE_INGEST_TOGGLE_SECRET is set on the server.
 */

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Vehicle-Ingest-Toggle-Secret',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function PATCH(request: Request) {
  const secret = process.env.VEHICLE_INGEST_TOGGLE_SECRET;
  if (secret && request.headers.get('x-vehicle-ingest-toggle-secret') !== secret) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  let body: { device_id?: string; deviceId?: string; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const deviceId = (body.device_id ?? body.deviceId ?? '').trim();
  const enabled = body.enabled;
  if (!deviceId || typeof enabled !== 'boolean') {
    return new Response(
      JSON.stringify({ ok: false, error: 'Need device_id (string) and enabled (boolean)' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const { data: existing, error: selErr } = await supabase
    .from('tracker_latest')
    .select('device_id')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (selErr) {
    return new Response(
      JSON.stringify({ ok: false, error: selErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }

  if (!existing) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'No tracker_latest row for this device_id yet; ingest once, then toggle.',
      }),
      { status: 404, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }

  const { error: updErr } = await supabase
    .from('tracker_latest')
    .update({
      ingest_enabled: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('device_id', deviceId);

  if (updErr) {
    return new Response(JSON.stringify({ ok: false, error: updErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  return new Response(JSON.stringify({ ok: true, device_id: deviceId, ingest_enabled: enabled }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
