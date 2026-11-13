#!/usr/bin/env tsx
/**
 * One-shot OAuth helper: produces a Google Search Console refresh token.
 *
 *   npx tsx tools/get-gsc-refresh-token.ts
 *
 * Flow:
 *   1. Reads GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET from .env.
 *   2. Starts a loopback HTTP server on a free port (127.0.0.1).
 *   3. Opens the browser to Google's consent screen with that port as the
 *      redirect_uri. access_type=offline + prompt=consent force a refresh token.
 *   4. Catches the ?code=... callback, exchanges it for tokens, prints the
 *      refresh token for you to paste into GOOGLE_OAUTH_REFRESH_TOKEN.
 *
 * Dev tokens from an unverified OAuth app expire after 7 days — rerun this
 * script when the GSC job starts failing with invalid_grant. For production,
 * publish the OAuth consent screen (Google Auth Platform → Audience → Publish).
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env ourselves — no project imports so tsx can run this standalone.
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

const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'];
const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'];
if (!clientId || !clientSecret) {
  console.error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in .env');
  process.exit(1);
}

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

function openInBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? `open "${url}"`
    : platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log('\nCould not auto-open browser. Open this URL manually:\n');
      console.log(`  ${url}\n`);
    }
  });
}

// Build the server and keep it open; the request handler resolves `codePromise`
// when Google redirects back with ?code=...
let resolveCode!: (code: string) => void;
let rejectCode!: (err: Error) => void;
const codePromise = new Promise<string>((r, rej) => { resolveCode = r; rejectCode = rej; });

const server = createServer((req, res) => {
  if (!req.url) { res.writeHead(400).end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/') { res.writeHead(404).end(); return; }
  const error = url.searchParams.get('error');
  if (error) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end(`OAuth error: ${error}`);
    rejectCode(new Error(`OAuth error: ${error}`));
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('No code in callback.');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' }).end(
    `<html><body style="font-family:system-ui;max-width:400px;margin:4rem auto;text-align:center">
      <h2>&#10003; Authorization received</h2>
      <p>You can close this tab and return to the terminal.</p>
    </body></html>`,
  );
  resolveCode(code);
});

// Bind to a random free port. The server stays open until we close it after
// the token exchange.
const port = await new Promise<number>((r, rej) => {
  server.on('error', rej);
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') { rej(new Error('could not bind local server')); return; }
    r(addr.port);
  });
});

const redirectUri = `http://127.0.0.1:${port}`;
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log(`\nListening on ${redirectUri}`);
console.log('\nOpening browser to Google consent screen…');
console.log(`If it doesn't open, paste this URL:\n\n  ${authUrl.toString()}\n`);
openInBrowser(authUrl.toString());

const code = await codePromise;
console.log('\nAuthorization code received, exchanging for refresh token…');

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }).toString(),
});

server.close();

const tokenJson = await tokenRes.json() as { refresh_token?: string; error?: string; error_description?: string };
if (tokenJson.error) {
  console.error(`\nToken exchange failed: ${tokenJson.error} — ${tokenJson.error_description ?? ''}`);
  process.exit(1);
}
if (!tokenJson.refresh_token) {
  console.error('\nNo refresh_token in response. This happens when the account previously consented and Google returned only an access token.');
  console.error('Fix: revoke the app at https://myaccount.google.com/permissions, then rerun this script.');
  process.exit(1);
}

console.log('\n==================== REFRESH TOKEN ====================');
console.log(tokenJson.refresh_token);
console.log('=======================================================\n');
console.log('Paste into .env:');
console.log('  GOOGLE_SEARCH_CONSOLE_AUTH=oauth');
console.log(`  GOOGLE_OAUTH_REFRESH_TOKEN=${tokenJson.refresh_token}\n`);

process.exit(0);
