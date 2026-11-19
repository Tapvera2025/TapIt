import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

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
      // The SEO content editor's collaboration socket (Hocuspocus, its own port).
      // Exact path only, and listed first: the first matching entry wins.
      [`^${apiBasePath}/collab(?:\\?|$)`]: {
        target: process.env['VITE_CONTENT_COLLAB_PROXY_TARGET'] ?? 'http://localhost:4001',
        ws: true,
      },
      [apiBasePath]: {
        target: process.env['VITE_API_PROXY_TARGET'] ?? 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The app, plus the public pages that must load without the app or a sign-in
    // (Google and Meta check them): served at /about, /privacy, /terms and
    // /data-deletion by the dev server and by nginx.
    rollupOptions: {
      input: {
        main: page('./index.html'),
        about: page('./about.html'),
        privacy: page('./privacy.html'),
        terms: page('./terms.html'),
        'data-deletion': page('./data-deletion.html'),
      },
    },
  },
});
