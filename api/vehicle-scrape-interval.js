// _api/vehicle-scrape-interval.ts
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Vehicle-Ingest-Toggle-Secret"
};
var MIN_INTERVAL_MS = 15e3;
var MAX_INTERVAL_MS = 3e5;
async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
async function PATCH(request) {
  const secret = process.env.VEHICLE_INGEST_TOGGLE_SECRET;
  if (secret && request.headers.get("x-vehicle-ingest-toggle-secret") !== secret) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  }
  const deviceId = (body.device_id ?? body.deviceId ?? "").trim();
  const raw = Number(body.scrape_interval_ms);
  const intervalMs = Math.round(raw);
  if (!deviceId || !Number.isFinite(intervalMs)) {
    return new Response(
      JSON.stringify({ ok: false, error: "Need device_id (string) and scrape_interval_ms (number)" }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
  if (intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `scrape_interval_ms must be between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS}`
      }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return new Response(JSON.stringify({ ok: false, error: "Supabase not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key);
  const { data: existing, error: selErr } = await supabase.from("tracker_latest").select("device_id").eq("device_id", deviceId).maybeSingle();
  if (selErr) {
    return new Response(JSON.stringify({ ok: false, error: selErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  }
  if (!existing) {
    return new Response(
      JSON.stringify({ ok: false, error: "No tracker_latest row for this device_id yet; ingest once first." }),
      { status: 404, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
  const updatePayload = {
    scrape_interval_ms: intervalMs,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  let { error: updErr } = await supabase.from("tracker_latest").update(updatePayload).eq("device_id", deviceId);
  if (updErr) {
    const msg = `${updErr.message ?? ""}`.toLowerCase();
    const retryable = updErr.code === "42703" || updErr.code === "PGRST204" || msg.includes("column") && msg.includes("does not exist");
    if (retryable) {
      ({ error: updErr } = await supabase.from("tracker_latest").update({ updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("device_id", deviceId));
      if (!updErr) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "tracker_latest.scrape_interval_ms column is missing. Add it in Supabase before using per-device intervals."
          }),
          { status: 409, headers: { "Content-Type": "application/json", ...CORS } }
        );
      }
    }
  }
  if (updErr) {
    return new Response(JSON.stringify({ ok: false, error: updErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  }
  return new Response(
    JSON.stringify({ ok: true, device_id: deviceId, scrape_interval_ms: intervalMs }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS } }
  );
}
export {
  OPTIONS,
  PATCH
};
