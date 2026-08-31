import net from 'node:net';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

async function canConnect(targetUrl: string, timeoutMs = 250): Promise<boolean> {
  try {
    const url = new URL(targetUrl);
    const port = Number(url.port);

    if (!Number.isFinite(port) || port <= 0) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: url.hostname, port });

      const finish = (value: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  } catch {
    return false;
  }
}

async function resolveApiProxyTarget(mode: string): Promise<string> {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  const env = loadEnv(mode, repoRoot, '');

  const candidates = [
    env['VITE_API_PROXY_TARGET'],
    env['API_PORT'] ? `http://localhost:${env['API_PORT']}` : undefined,
    'http://localhost:4000',
    'http://localhost:4012',
    'http://localhost:4001',
  ].filter((value): value is string => Boolean(value));

  for (const target of candidates) {
    if (await canConnect(target)) {
      return target;
    }
  }

  return candidates[0] ?? 'http://localhost:4000';
}

export default defineConfig(async ({ mode }) => {
  const apiProxyTarget = await resolveApiProxyTarget(mode);

  return {
    plugins: [react()],

    server: {
      host: 'localhost',
      port: 5173,

      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },

    preview: {
      host: 'localhost',
      port: 5173,
    },

    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
    },
  };
});
