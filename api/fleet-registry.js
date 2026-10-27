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

// src/lib/fleet/registry.ts
var DEFAULT_ROUTE_ID = "00000000-0000-4000-8000-000000000001";
var registry = {
  vehicles: { table: "fleet_vehicles", label: "Vehicles", fields: [
    { key: "plate_number", label: "Plate number", required: true },
    { key: "device_id", label: "GPS device ID (optional)" },
    { key: "driver_id", label: "Driver", reference: "drivers" },
    { key: "route_id", label: "Route", reference: "routes" },
    { key: "capacity", label: "Capacity", required: true, type: "number", min: 1, max: 100 },
    { key: "availability", label: "Availability", required: true, type: "select", options: ["active", "inactive", "maintenance"] }
  ] },
  drivers: { table: "fleet_drivers", label: "Drivers", fields: [
    { key: "name", label: "Full name", required: true },
    { key: "phone", label: "Phone (optional)" }
  ] },
  routes: { table: "fleet_routes", label: "Routes", fields: [
    { key: "code", label: "Route code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "origin", label: "Origin", required: true },
    { key: "destination", label: "Destination", required: true }
  ] },
  stations: { table: "fleet_stations", label: "Stations", fields: [
    { key: "name", label: "Station name", required: true },
    { key: "location", label: "City / municipality", required: true },
    { key: "route_id", label: "Route", required: true, reference: "routes" },
    { key: "station_number", label: "Station number", required: true, type: "number", min: 1, max: 100 },
    { key: "latitude", label: "Latitude", required: true, type: "number", min: -90, max: 90 },
    { key: "longitude", label: "Longitude", required: true, type: "number", min: -180, max: 180 }
  ] }
};
function validEntity(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(registry, value);
}
var isUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function validateRecord(entity, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid record");
  const row = {};
  for (const field of registry[entity].fields) {
    const raw = input[field.key];
    if (raw == null || raw === "") {
      if (field.required) throw new Error(`${field.label} is required`);
      row[field.key] = null;
      continue;
    }
    if (field.type === "number") {
      if (typeof raw !== "number" && typeof raw !== "string") throw new Error(`Invalid ${field.label}`);
      const number = Number(raw);
      if (!Number.isFinite(number) || number < field.min || number > field.max || ["capacity", "station_number"].includes(field.key) && !Number.isInteger(number)) throw new Error(`Invalid ${field.label}`);
      row[field.key] = number;
    } else {
      if (typeof raw !== "string") throw new Error(`Invalid ${field.label}`);
      const text = raw.trim();
      if (!text || text.length > 160 || /[\x00-\x1f]/.test(text)) throw new Error(`Invalid ${field.label}`);
      if (field.reference && !isUuid(text)) throw new Error(`Invalid ${field.label}`);
      if (field.options && !field.options.includes(text)) throw new Error(`Invalid ${field.label}`);
      row[field.key] = field.key === "plate_number" || field.key === "code" ? text.toUpperCase() : text;
    }
  }
  return row;
}

// _api/fleet-registry.ts
async function GET(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const entity = url.searchParams.get("entity");
  if (!validEntity(entity)) return json({ error: "Unknown record type" }, 400);
  const page = Math.max(0, Math.min(1e4, Math.floor(Number(url.searchParams.get("page")) || 0)));
  const queryText = (url.searchParams.get("search") ?? "").trim().slice(0, 80).replace(/[%_\\]/g, "");
  let query = serverDb().from(registry[entity].table).select("*", { count: "exact" }).order("updated_at", { ascending: false }).order("id");
  query = url.searchParams.get("archived") === "true" ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (queryText) query = query.ilike(entity === "vehicles" ? "plate_number" : "name", `%${queryText}%`);
  const { data, count, error } = await query.range(page * 25, page * 25 + 24);
  if (error) return json({ error: "Unable to load records. Check database setup." }, 503);
  return json({ records: data, total: count });
}
async function POST(request) {
  return save(request, false);
}
async function PATCH(request) {
  return save(request, true);
}
async function save(request, update) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body || !validEntity(body.entity) || update && !isUuid(body.id)) return json({ error: "Invalid record request" }, 400);
  let values;
  try {
    if (update && typeof body.archived === "boolean") {
      if (body.archived && body.entity === "routes" && body.id === DEFAULT_ROUTE_ID) throw new Error("The current public route cannot be archived.");
      values = { archived_at: body.archived ? (/* @__PURE__ */ new Date()).toISOString() : null };
    } else values = validateRecord(body.entity, body.record);
  } catch (error2) {
    return json({ error: error2.message }, 400);
  }
  const db = serverDb();
  for (const field of registry[body.entity].fields) {
    if (!field.reference || !values[field.key]) continue;
    const ref = await db.from(registry[field.reference].table).select("id").eq("id", values[field.key]).is("archived_at", null).maybeSingle();
    if (ref.error || !ref.data) return json({ error: `Select an active ${field.label.toLowerCase()}` }, 400);
  }
  values.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  const table = db.from(registry[body.entity].table);
  const { data, error } = await (update ? table.update(values).eq("id", body.id) : table.insert(values)).select().maybeSingle();
  if (error) return json({ error: error.code === "23505" ? "That plate, device ID, route code or station number already exists." : "Unable to save this record." }, error.code === "23505" ? 409 : 400);
  if (!data) return json({ error: "Record no longer exists" }, 404);
  return json({ record: data }, update ? 200 : 201);
}
var fleet_registry_default = nodeHandler({ GET, POST, PATCH });
export {
  GET,
  PATCH,
  POST,
  fleet_registry_default as default
};
