import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closePools } from './platform/dal/pool.js';

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

  const forced = setTimeout(() => {
    console.error(JSON.stringify({ level: 'fatal', msg: 'graceful shutdown timed out' }));
    process.exit(code === 0 ? 1 : code);
  }, 15_000);
  forced.unref();

  server.close(() => {
    void closePools().finally(() => {
      clearTimeout(forced);
      process.exit(code);
    });
  });
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
