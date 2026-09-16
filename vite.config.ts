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

    return {
        plugins: [tailwindcss(), react()],
        define: {
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
            'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnon),
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