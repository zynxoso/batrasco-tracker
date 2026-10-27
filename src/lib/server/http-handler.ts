export function nodeHandler(methods: Record<string, (request: Request) => Promise<Response>>) {
  return async (req: any, res?: any) => {
    let response: Response;
    try {
      const method = req.method || 'GET';
      const headers = new Headers();
      if (req instanceof Request) req.headers.forEach((value, key) => headers.set(key, value));
      else for (const [key, value] of Object.entries(req.headers ?? {})) if (value) headers.set(key, String(value));
      const body = !['GET', 'HEAD'].includes(method) && req.body != null
        ? typeof req.body === 'string' ? req.body : JSON.stringify(req.body) : undefined;
      const request = req instanceof Request ? req : new Request(`http://localhost${req.url}`, { method, headers, body });
      response = methods[method] ? await methods[method](request) : new Response('Method not allowed', { status: 405, headers: { Allow: Object.keys(methods).join(', ') } });
    } catch { response = new Response(JSON.stringify({ error: 'Request could not be completed' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
    if (!res) return response;
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  };
}
