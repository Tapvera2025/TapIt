import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';


export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: process.env['VITE_HOST'] ?? 'localhost',
    proxy: {
      '/api': {
        target: process.env['VITE_API_PROXY_TARGET'] ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
