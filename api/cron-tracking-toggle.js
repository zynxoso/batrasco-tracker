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

// src/lib/server/cron-state.ts
async function getCronTrackingEnabled() {
  const db = serverDb();
  if (!db) return { enabled: false, source: "default", reason: "Database unavailable" };
  const { data, error } = await db.from("fleet_settings").select("tracking_enabled").eq("id", true).single();
  if (error) return { enabled: false, source: "default", reason: "Tracking settings unavailable" };
  return { enabled: data.tracking_enabled, source: "database" };
}
async function setCronTrackingEnabled(enabled) {
  const db = serverDb();
  if (!db) throw new Error("Database unavailable");
  const { data, error } = await db.from("fleet_settings").update({ tracking_enabled: enabled, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", true).select("id").single();
  if (error || !data) throw new Error("Tracking settings could not be saved");
  return { enabled, source: "database" };
}

// _api/cron-tracking-toggle.ts
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
  });
}
async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
async function GET(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const state = await getCronTrackingEnabled();
  return jsonResponse(200, { ok: true, ...state });
}
async function PATCH(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON" });
  }
  if (typeof body.enabled !== "boolean") {
    return jsonResponse(400, { ok: false, error: "Need enabled (boolean)" });
  }
  try {
    const state = await setCronTrackingEnabled(body.enabled);
    return jsonResponse(200, { ok: true, ...state });
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    });
  }
}
var cron_tracking_toggle_default = nodeHandler({ OPTIONS, GET, PATCH });
export {
  GET,
  OPTIONS,
  PATCH,
  cron_tracking_toggle_default as default
};
