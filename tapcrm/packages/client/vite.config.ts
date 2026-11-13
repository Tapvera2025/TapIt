import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const configuredApiBasePath = process.env['VITE_API_BASE_PATH'] || '/api';
const apiBasePath = `/${configuredApiBasePath.replace(/^\/+|\/+$/g, '')}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // 127.0.0.1 rather than "localhost": on macOS "localhost" binds IPv6 only,
    // and browsers that try 127.0.0.1 then cannot reach the dev server.
    host: process.env['VITE_HOST'] ?? '127.0.0.1',
    proxy: {
      [apiBasePath]: {
        target: process.env['VITE_API_PROXY_TARGET'] ?? 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
