// src/lib/server/cron-state.ts
var KEY = "tracker:cron:enabled:v1";
function kvUrl() {
  return process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
}
function kvToken() {
  return process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
}
async function getKv() {
  const url = kvUrl();
  const token = kvToken();
  if (!url || !token) return null;
  const { createClient } = await import("@vercel/kv");
  return createClient({ url, token, automaticDeserialization: false });
}
function parseStored(raw) {
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw;
  const text = String(raw).trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
}
async function getCronTrackingEnabled() {
  const kv = await getKv();
  if (!kv) {
    return { enabled: true, source: "default", reason: "KV not configured" };
  }
  try {
    const raw = await kv.get(KEY);
    const parsed = parseStored(raw);
    if (parsed === null) {
      return { enabled: true, source: "default", reason: "unset" };
    }
    return { enabled: parsed, source: "kv" };
  } catch (e) {
    return {
      enabled: true,
      source: "default",
      reason: e instanceof Error ? e.message : String(e)
    };
  }
}
async function setCronTrackingEnabled(enabled) {
  const kv = await getKv();
  if (!kv) {
    return { enabled: true, source: "default", reason: "KV not configured" };
  }
  await kv.set(KEY, enabled ? "true" : "false");
  return { enabled, source: "kv" };
}

// _api/cron-tracking-toggle.ts
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Vehicle-Ingest-Toggle-Secret"
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
async function GET() {
  const state = await getCronTrackingEnabled();
  return jsonResponse(200, { ok: true, ...state });
}
async function PATCH(request) {
  const secret = process.env.VEHICLE_INGEST_TOGGLE_SECRET;
  if (secret && request.headers.get("x-vehicle-ingest-toggle-secret") !== secret) {
    return jsonResponse(403, { ok: false, error: "Forbidden" });
  }
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
export {
  GET,
  OPTIONS,
  PATCH
};
