#!/usr/bin/env tsx
/**
 * Smoke test for the GSC OAuth config:
 *   1. Loads client_id / client_secret / refresh_token from .env
 *   2. Exchanges the refresh token for an access token
 *   3. Lists every GSC property the authenticated account can see
 *
 *   npx tsx tools/test-gsc-auth.ts
 *
 * Success = you see a list of your Search Console properties.
 * The SEO Intelligence sync will later work on any property shown here.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
const refreshToken = process.env['GOOGLE_OAUTH_REFRESH_TOKEN'];

if (!clientId || !clientSecret || !refreshToken) {
  console.error('Missing OAuth env vars. Run tools/get-gsc-refresh-token.ts first.');
  process.exit(1);
}

console.log('\nExchanging refresh token for access token…');
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString(),
});
const tokenJson = await tokenRes.json() as { access_token?: string; error?: string; error_description?: string };
if (tokenJson.error || !tokenJson.access_token) {
  console.error(`\nAccess token exchange failed: ${tokenJson.error} — ${tokenJson.error_description ?? ''}`);
  console.error('Rerun tools/get-gsc-refresh-token.ts to get a fresh refresh token.');
  process.exit(1);
}
console.log('Access token OK.');

console.log('\nListing Search Console properties…');
const sitesRes = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
  headers: { authorization: `Bearer ${tokenJson.access_token}` },
});
if (!sitesRes.ok) {
  const body = await sitesRes.text();
  console.error(`\nGSC API returned HTTP ${sitesRes.status}`);
  console.error(body.slice(0, 500));
  if (sitesRes.status === 403) {
    console.error('\n→ The Search Console API may not be enabled in your Cloud project.');
    console.error('  Enable it at: https://console.cloud.google.com/apis/library/searchconsole.googleapis.com');
  }
  process.exit(1);
}
const sitesJson = await sitesRes.json() as {
  siteEntry?: Array<{ siteUrl: string; permissionLevel: string }>;
  error?: { message: string };
};
if (sitesJson.error) {
  console.error(`\nGSC API returned an error: ${sitesJson.error.message}`);
  process.exit(1);
}
const sites = sitesJson.siteEntry ?? [];
if (sites.length === 0) {
  console.log('\n(No Search Console properties on this account.)');
  console.log('Add properties at https://search.google.com/search-console first, then retry.');
  process.exit(0);
}

console.log(`\nFound ${sites.length} propert${sites.length === 1 ? 'y' : 'ies'}:\n`);
for (const site of sites) {
  console.log(`  ${site.permissionLevel.padEnd(16)} ${site.siteUrl}`);
}
console.log('\n✓ GSC auth is fully wired. The seo:gsc_sync job can pull data for any of these.\n');
process.exit(0);
