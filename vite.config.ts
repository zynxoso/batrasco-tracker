import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
    plugins: [tailwindcss(), react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            'figma:asset': path.resolve(__dirname, './src/assets'),
        },
    },
    server: {
        port: 3000,
        // If you have deployed the backend to Vercel, Vite can proxy /api calls to it:
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
});