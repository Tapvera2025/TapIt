import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const configuredApiBasePath = process.env['VITE_API_BASE_PATH'] || '/api';
const apiBasePath = `/${configuredApiBasePath.replace(/^\/+|\/+$/g, '')}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: process.env['VITE_HOST'] ?? 'localhost',
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
