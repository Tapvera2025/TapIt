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
    // Strip a matching pair of surrounding quotes so `NAME="Foo Bar"` yields
    // `Foo Bar`, not the literal `"Foo Bar"` — dotenv, docker compose and
    // shells all do this; a hand-rolled reader that skips it stores quotes as
    // part of the value.
    if (val.length >= 2) {
      const first = val[0];
      if ((first === '"' || first === "'") && val[val.length - 1] === first) {
        val = val.slice(1, -1);
      }
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closePools } from './platform/dal/pool.js';
import { purgeAllExpiredGeofenceCoordinates } from './modules/identity/geofence/privacy.js';
import { startBackgroundJobs, stopBackgroundJobs } from './platform/jobs.js';
import { startAuditDrainer, stopAuditDrainer } from './modules/audit/drainer.js';
import { startNotificationDispatcher, stopNotificationDispatcher } from './modules/notifications/dispatcher.js';
import { resolvePrincipalFromToken } from './modules/identity/index.js';
import { startRealtime, stopRealtime } from './platform/realtime/index.js';

/**
 * Entry point.
 *
 * DP-2 requires zero-downtime rolling deployments, which needs a real graceful
 * shutdown: stop accepting connections, let in-flight requests finish, then
 * drain the pool. A process that exits on SIGTERM mid-transaction produces the
 * ambiguous-commit case in §9.7.1 for every request in flight.
 */

const config = loadConfig();
const app = buildApp();

const server = app.listen(config.API_PORT, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'tapcrm api listening',
      port: config.API_PORT,
      basePath: config.API_BASE_PATH,
      env: config.NODE_ENV,
    }),
  );
});

// AU-I1 — business transactions only write the outbox; this chains it. It needs
// PostgreSQL only, so unlike the job queue below it does not depend on Redis.
startAuditDrainer();

// Notification outbox -> per-recipient rows -> socket signal. Also PostgreSQL-only.
startNotificationDispatcher();

// RT-1: the handshake uses the same token and session-version check as HTTP.
void startRealtime(server, async (token, options) => {
  const resolved = await resolvePrincipalFromToken(token, options);
  return resolved ? { userId: resolved.principal.id, organizationId: resolved.organizationId } : null;
}).catch((error: unknown) => {
  console.error(JSON.stringify({ level: 'error', msg: 'realtime unavailable', error: String(error) }));
});

let geofenceRetentionTimer: NodeJS.Timeout | null = null;
void startBackgroundJobs().catch((error: unknown) => {
  // Keep local development safe if Redis is temporarily unavailable. The
  // durable scheduler is used whenever the existing Redis service is healthy.
  console.error(JSON.stringify({ level: 'error', msg: 'background jobs unavailable; using local retention fallback', error: String(error) }));
  geofenceRetentionTimer = setInterval(() => {
    void purgeAllExpiredGeofenceCoordinates().catch((purgeError: unknown) => {
      console.error(JSON.stringify({ level: 'error', msg: 'geofence coordinate purge failed', error: String(purgeError) }));
    });
  }, 24 * 60 * 60 * 1000);
  geofenceRetentionTimer.unref();
});

// DP-10 — "an unhealthy application container must not silently remain in
// service." Anything unhandled here is a defect; exit and let the orchestrator
// restart rather than serving from an unknown state.
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

  server.close(() => {
    // Let an in-flight audit batch commit before the pool is drained.
    void Promise.all([stopAuditDrainer(), stopNotificationDispatcher()]).then(stopRealtime).then(closePools).finally(() => {
      void stopBackgroundJobs();
      clearTimeout(forced);
      process.exit(code);
    });
  });
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
