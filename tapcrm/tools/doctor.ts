#!/usr/bin/env tsx
/**
 * Preflight for a fresh clone.
 *
 * A new developer's failures land one at a time: docker not running, then port
 * 5432 busy, then a placeholder secret refused by compose. Each cycle is a
 * container rebuild. This checks them all in one pass so the first
 * `docker compose up` succeeds.
 *
 *   npm run doctor
 *
 * Exit codes:
 *   0  all checks passed
 *   1  at least one blocking check failed
 */

import { execSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Severity = 'ok' | 'warn' | 'fail';
interface Check {
  readonly name: string;
  readonly severity: Severity;
  readonly detail: string;
  readonly fix?: string;
}
const results: Check[] = [];

const ok = (name: string, detail: string) =>
  results.push({ name, severity: 'ok', detail });
const warn = (name: string, detail: string, fix?: string) =>
  results.push(fix === undefined ? { name, severity: 'warn', detail } : { name, severity: 'warn', detail, fix });
const fail = (name: string, detail: string, fix?: string) =>
  results.push(fix === undefined ? { name, severity: 'fail', detail } : { name, severity: 'fail', detail, fix });

/* ---- .env parsing (matches server/src/index.ts) ---------------------- */

function loadEnvFile(): Record<string, string> | null {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return null;
  const out: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.length >= 2) {
      const first = val[0];
      if ((first === '"' || first === "'") && val[val.length - 1] === first) {
        val = val.slice(1, -1);
      }
    }
    out[key] = val;
  }
  return out;
}

/* ---- Checks ---------------------------------------------------------- */

function checkNodeVersion(): void {
  const nvmrc = resolve(ROOT, '.nvmrc');
  if (!existsSync(nvmrc)) {
    warn('Node version', 'no .nvmrc — cannot check against a pinned version');
    return;
  }
  const required = readFileSync(nvmrc, 'utf8').trim();
  const [got] = process.versions.node.split('.');
  const [want] = required.split('.');
  if (got !== undefined && want !== undefined && Number(got) >= Number(want)) {
    ok('Node version', `${process.versions.node} (needed >= ${required})`);
  } else {
    fail(
      'Node version',
      `${process.versions.node} — needed >= ${required}`,
      'Run `nvm use` (or install Node ' + required + ' if nvm is not installed).',
    );
  }
}

function checkDocker(): void {
  try {
    execSync('docker ps', { stdio: 'ignore' });
    ok('Docker daemon', 'reachable');
  } catch {
    fail(
      'Docker daemon',
      '`docker ps` failed',
      'Start Docker Desktop (or your Docker daemon). The compose stack needs it.',
    );
  }
}

function checkEnvFile(): Record<string, string> | null {
  const env = loadEnvFile();
  if (env === null) {
    fail(
      '.env exists',
      'missing',
      'Copy the template: `cp .env.example .env`, then fill in every `replace-me` value.',
    );
    return null;
  }
  ok('.env exists', 'found');
  return env;
}

function checkPlaceholderSecrets(env: Record<string, string>): void {
  const placeholders = Object.entries(env).filter(([, v]) => v.includes('replace-me'));
  if (placeholders.length === 0) {
    ok('.env secrets', 'no `replace-me` placeholders remain');
    return;
  }
  fail(
    '.env secrets',
    `${placeholders.length} value(s) still contain \`replace-me\`: ${placeholders.map(([k]) => k).join(', ')}`,
    'Generate secrets: `openssl rand -hex 32` for JWT_*/POSTGRES_*, choose your own for admin.',
  );
}

function checkJwtSecrets(env: Record<string, string>): void {
  const access = env['JWT_ACCESS_SECRET'] ?? '';
  const refresh = env['JWT_REFRESH_SECRET'] ?? '';
  const problems: string[] = [];
  if (access.length < 32) problems.push('JWT_ACCESS_SECRET is under 32 chars');
  if (refresh.length < 32) problems.push('JWT_REFRESH_SECRET is under 32 chars');
  if (access !== '' && access === refresh) problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are identical');
  if (problems.length > 0) {
    fail('JWT secrets', problems.join('; '), 'Both must be 32+ characters and DIFFERENT. `openssl rand -hex 32` twice.');
  } else {
    ok('JWT secrets', 'both 32+ chars and distinct');
  }
}

function checkAdminPassword(env: Record<string, string>): void {
  const pw = env['PLATFORM_ADMIN_PASSWORD'] ?? '';
  if (pw.length < 12) {
    fail(
      'PLATFORM_ADMIN_PASSWORD',
      pw.length === 0 ? 'not set' : `only ${pw.length} chars — needs 12+`,
      'Choose a 12+ character password. The bootstrap script refuses shorter values.',
    );
  } else {
    ok('PLATFORM_ADMIN_PASSWORD', `${pw.length} chars`);
  }
}

async function checkPort(name: string, port: number): Promise<Severity> {
  return new Promise<Severity>((resolvePromise) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const done = (result: Severity): void => {
      socket.destroy();
      resolvePromise(result);
    };
    socket.once('connect', () => done('warn'));   // something is listening
    socket.once('error', () => done('ok'));       // nothing there — free
    setTimeout(() => done('ok'), 500);
  }).then((severity) => {
    if (severity === 'warn') {
      warn(
        `Port ${port}`,
        `in use (${name})`,
        `Another process is on ${port}. Change ${name} in .env, or stop the other process.`,
      );
    } else {
      ok(`Port ${port}`, `free (${name})`);
    }
    return severity;
  });
}

async function checkPorts(env: Record<string, string>): Promise<void> {
  const ports: [string, number][] = [
    ['POSTGRES_HOST_PORT', Number(env['POSTGRES_HOST_PORT'] ?? 5432)],
    ['REDIS_HOST_PORT', Number(env['REDIS_HOST_PORT'] ?? 6379)],
    ['MINIO_API_HOST_PORT', Number(env['MINIO_API_HOST_PORT'] ?? 9000)],
    ['MINIO_CONSOLE_HOST_PORT', Number(env['MINIO_CONSOLE_HOST_PORT'] ?? 9001)],
    ['API_PORT', Number(env['API_PORT'] ?? 4000)],
    ['WEB_PORT', Number(env['WEB_PORT'] ?? 5173)],
  ];
  await Promise.all(ports.map(([name, port]) => checkPort(name, port)));
}

async function checkArgon2(): Promise<void> {
  try {
    const mod = await import('argon2');
    // Prove the native binding actually loaded, not just the JS wrapper.
    await mod.default.hash('doctor-check', { type: mod.default.argon2id });
    ok('argon2 native module', 'built and callable');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    fail(
      'argon2 native module',
      `not usable: ${msg.split('\n')[0]}`,
      'Install build tools (macOS: `xcode-select --install`; Debian/Ubuntu: `apt install build-essential`) then `rm -rf node_modules && npm install`.',
    );
  }
}

/* ---- Run ------------------------------------------------------------- */

console.log('\nTapCRM preflight — checking the environment for a first run\n');

checkNodeVersion();
checkDocker();
const env = checkEnvFile();
if (env !== null) {
  checkPlaceholderSecrets(env);
  checkJwtSecrets(env);
  checkAdminPassword(env);
  await checkPorts(env);
}
await checkArgon2();

const icon: Record<Severity, string> = { ok: '✓', warn: '⚠', fail: '✗' };
for (const r of results) {
  console.log(`  ${icon[r.severity]}  ${r.name.padEnd(28)} ${r.detail}`);
  if (r.fix !== undefined) console.log(`      → ${r.fix}`);
}

const failed = results.filter((r) => r.severity === 'fail').length;
const warned = results.filter((r) => r.severity === 'warn').length;
const passed = results.filter((r) => r.severity === 'ok').length;

console.log();
if (failed > 0) {
  console.log(`✗ ${failed} check(s) failed, ${warned} warning(s), ${passed} passed. Fix the failures above before \`docker compose up\`.`);
  process.exit(1);
}
if (warned > 0) {
  console.log(`⚠ ${warned} warning(s), ${passed} passed. Proceed if the warnings are expected (e.g., you meant to use those ports).`);
} else {
  console.log(`✓ ${passed} check(s) passed. You're ready — run \`docker compose up --build\`.`);
}
