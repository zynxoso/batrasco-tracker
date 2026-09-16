// _api/ping.ts
function GET() {
  return new Response(JSON.stringify({ ok: true, route: "ping" }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
export {
  GET
};
