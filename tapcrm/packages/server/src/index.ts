import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.length >= 2) {
      const first = val[0];
      if ((first === '"' || first === "'") && val[val.length - 1] === first) val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closePools } from './platform/dal/pool.js';
import { purgeAllExpiredGeofenceCoordinates } from './modules/identity/geofence/privacy.js';
import { registerAllJobs } from './modules/index.js';
import { startAuditDrainer, stopAuditDrainer } from './modules/audit/drainer.js';
import { startNotificationDispatcher, stopNotificationDispatcher } from './modules/notifications/dispatcher.js';
import { startJobs, stopJobs } from './platform/jobs/runner.js';
import { startOutboxDrainer, stopOutboxDrainer } from './platform/outbox/drainer.js';
import { startRealtime, stopRealtime } from './platform/realtime/server.js';

/**
 * The process starts the scoped People socket service once. It carries both
 * status invalidations and personal notification events; database outboxes
 * remain the source of truth if the socket service is temporarily unavailable.
 */
const config = loadConfig();
const app = buildApp();
const server = app.listen(config.API_PORT, () => {
  console.log(JSON.stringify({
    level: 'info',
    msg: 'tapcrm api listening',
    port: config.API_PORT,
    basePath: config.API_BASE_PATH,
    env: config.NODE_ENV,
  }));
});

startAuditDrainer();
void startRealtime(server)
  .catch((error: unknown) => {
    console.error(JSON.stringify({ level: 'error', msg: 'realtime unavailable', error: String(error) }));
  })
  .finally(() => {
    startOutboxDrainer();
    startNotificationDispatcher();
  });

registerAllJobs();
let geofenceRetentionTimer: NodeJS.Timeout | null = null;
void startJobs().catch((error: unknown) => {
  console.error(JSON.stringify({ level: 'error', msg: 'background jobs unavailable; using local retention fallback', error: String(error) }));
  geofenceRetentionTimer = setInterval(() => {
    void purgeAllExpiredGeofenceCoordinates().catch((purgeError: unknown) => {
      console.error(JSON.stringify({ level: 'error', msg: 'geofence coordinate purge failed', error: String(purgeError) }));
    });
  }, 24 * 60 * 60 * 1000);
  geofenceRetentionTimer.unref();
});

process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'unhandled rejection', reason: String(reason) }));
  shutdown(1);
});

let shuttingDown = false;
function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (geofenceRetentionTimer) clearInterval(geofenceRetentionTimer);

  const forced = setTimeout(() => {
    console.error(JSON.stringify({ level: 'fatal', msg: 'graceful shutdown timed out' }));
    process.exit(code === 0 ? 1 : code);
  }, 15_000);
  forced.unref();

  void stopRealtime().finally(() => {
    server.close(() => {
      void Promise.allSettled([
        stopAuditDrainer(),
        stopOutboxDrainer(),
        stopNotificationDispatcher(),
      ])
        .then(() => stopJobs())
        .then(closePools)
        .finally(() => {
          clearTimeout(forced);
          process.exit(code);
        });
    });
  });
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
