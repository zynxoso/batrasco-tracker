// src/lib/server/access.ts
import { createClient } from "@supabase/supabase-js";
function serverDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
async function requireAdmin(request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: "Sign-in required" }, 401);
  const db = serverDb();
  if (!db) return json({ error: "Administration is not configured" }, 503);
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return json({ error: "Session expired or invalid" }, 401);
    const role = await db.from("fleet_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
    if (role.error) return json({ error: "Administration setup is incomplete" }, 503);
    return role.data ? null : json({ error: "Administrator access required" }, 403);
  } catch {
    return json({ error: "Authentication service unavailable" }, 503);
  }
}

// src/lib/server/http-handler.ts
function nodeHandler(methods) {
  return async (req, res) => {
    let response;
    try {
      const method = req.method || "GET";
      const headers = new Headers();
      if (req instanceof Request) req.headers.forEach((value, key) => headers.set(key, value));
      else for (const [key, value] of Object.entries(req.headers ?? {})) if (value) headers.set(key, String(value));
      const body = !["GET", "HEAD"].includes(method) && req.body != null ? typeof req.body === "string" ? req.body : JSON.stringify(req.body) : void 0;
      const request = req instanceof Request ? req : new Request(`http://localhost${req.url}`, { method, headers, body });
      response = methods[method] ? await methods[method](request) : new Response("Method not allowed", { status: 405, headers: { Allow: Object.keys(methods).join(", ") } });
    } catch {
      response = new Response(JSON.stringify({ error: "Request could not be completed" }), { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    if (!res) return response;
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  };
}

// _api/vehicle-scrape-interval.ts
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var MIN_INTERVAL_MS = 15e3;
var MAX_INTERVAL_MS = 3e5;
async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
async function PATCH(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
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
  const { createClient: createClient2 } = await import("@supabase/supabase-js");
  const supabase = createClient2(url, key);
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
var vehicle_scrape_interval_default = nodeHandler({ OPTIONS, PATCH });
export {
  OPTIONS,
  PATCH,
  vehicle_scrape_interval_default as default
};
