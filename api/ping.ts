/**
 * Minimal health check — no shared lib imports.
 * Use to verify Vercel Functions run (GET /api/ping → 200 JSON).
 */
export function GET() {
  return new Response(JSON.stringify({ ok: true, route: 'ping' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
