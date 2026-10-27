import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const supabaseUrl =
        env.VITE_SUPABASE_URL ||
        env.NEXT_PUBLIC_SUPABASE_URL ||
        env.SUPABASE_URL ||
        '';
    const supabaseAnon =
        env.VITE_SUPABASE_ANON_KEY ||
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        env.SUPABASE_ANON_KEY ||
        env.SUPABASE_PUBLISHABLE_KEY ||
        '';

    const cartoApiKey =
        env.VITE_CARTO_API_KEY ||
        env.CARTO_API_KEY ||
        '';

    return {
        plugins: [tailwindcss(), react(), {
            name: 'local-api',
            configureServer(server) {
                // Backend modules run only in Node; never expose service credentials to the browser.
                for (const [key, value] of Object.entries(env)) {
                    if (!key.startsWith('VITE_') && process.env[key] == null) process.env[key] = value;
                }
                if (process.env.VITE_API_PROXY_ORIGIN) return;
                server.middlewares.use(async (req, res, next) => {
                    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
                    const match = pathname.match(/^\/api\/([a-z-]+)$/);
                    if (!match) return next();
                    const allowed = ['vehicles','network','fleet-registry','vehicle-ingest-toggle','vehicle-scrape-interval','cron-tracking-toggle','tracker-history','trackers-poll','ingest','device','tracker','ping'];
                    if (!allowed.includes(match[1])) { res.statusCode = 404; return res.end('Not found'); }
                    try {
                        const chunks: Buffer[] = []; let bytes = 0;
                        for await (const chunk of req) {
                            bytes += Buffer.byteLength(chunk);
                            if (bytes > 65536) { res.statusCode=413; return res.end('Request too large'); }
                            chunks.push(Buffer.from(chunk));
                        }
                        (req as any).body = Buffer.concat(chunks).toString() || undefined;
                        const mod = await server.ssrLoadModule(`/_api/${match[1]}.ts`);
                        if (typeof mod.default === 'function') return await mod.default(req, res);
                        const fn=mod[req.method || 'GET'];
                        if(!fn){res.statusCode=405;return res.end('Method not allowed');}
                        const response=await fn(new Request(`http://localhost${req.url}`));
                        res.statusCode=response.status;response.headers.forEach((v:string,k:string)=>res.setHeader(k,v));res.end(await response.text());
                    } catch { res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Local API request failed'})); }
                });
            },
        }],
        define: {
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
            'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnon),
            'import.meta.env.VITE_CARTO_API_KEY': JSON.stringify(cartoApiKey),
        },
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
                'figma:asset': path.resolve(__dirname, './src/assets'),
            },
        },
        server: {
            port: 3000,
            proxy: process.env.VITE_API_PROXY_ORIGIN
                ? {
                    '/api': {
                        target: process.env.VITE_API_PROXY_ORIGIN,
                        changeOrigin: true,
                        secure: true,
                    },
                }
                : undefined,
        },
    };
});
