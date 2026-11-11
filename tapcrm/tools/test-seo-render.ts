#!/usr/bin/env tsx
/**
 * Smoke test for the headless renderer. Launches Chromium, renders a URL,
 * prints raw-vs-rendered byte deltas and the computed hashes so you can
 * confirm the C008 (raw ≠ rendered) rule has signal on this site.
 *
 *   npx tsx tools/test-seo-render.ts https://tapvera.io/
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

const url = process.argv[2] ?? 'https://tapvera.io/';

const [{ safeFetch }, { renderPage, shouldRender, closeRenderBrowser }, { parseHtml }] = await Promise.all([
  import('../packages/server/src/modules/seo-intelligence/crawler/http.ts'),
  import('../packages/server/src/modules/seo-intelligence/crawler/render.ts'),
  import('../packages/server/src/modules/seo-intelligence/crawler/parse.ts'),
]);

console.log(`\n→ Fetching ${url} (raw HTTP, no JS)…`);
const raw = await safeFetch(url);
const observation = parseHtml({ siteOrigin: url, fetch: raw });
console.log(`  status ${raw.status}  size ${raw.byteLength} bytes  elapsed ${raw.elapsedMs}ms`);
console.log(`  title: ${observation.title ?? '(none)'}`);
console.log(`  h1: ${observation.h1Text ?? '(none)'}  (count=${observation.h1Count})`);
console.log(`  word count: ${observation.wordCount}`);
console.log(`  raw content hash: ${observation.contentHash?.slice(0, 16)}…`);

const needs = shouldRender({
  wordCount: observation.wordCount,
  h1Count: observation.h1Count,
  title: observation.title,
});
console.log(`\n  heuristic says: ${needs ? 'needs render (JS-shelled)' : 'raw HTML looks complete'}`);

console.log(`\n→ Rendering via headless Chromium…`);
const rendered = await renderPage(url);
console.log(`  state: ${rendered.state}  elapsed ${rendered.elapsedMs}ms`);
if (rendered.state === 'ok' && rendered.contentHash) {
  console.log(`  rendered size: ${rendered.byteLength} bytes`);
  console.log(`  rendered content hash: ${rendered.contentHash.slice(0, 16)}…`);
  const changed = rendered.contentHash !== observation.contentHash;
  const sizeDelta = rendered.byteLength - raw.byteLength;
  console.log(`\n  ${changed ? '⚠' : '✓'} raw vs rendered: ${changed ? 'CONTENT CHANGED' : 'identical'}`);
  console.log(`  size delta: ${sizeDelta >= 0 ? '+' : ''}${sizeDelta} bytes`);
  if (changed) {
    console.log('  → C008 (raw ≠ rendered content) WOULD FIRE for this page.');
  } else {
    console.log('  → C008 would NOT fire. The page is fully server-rendered.');
  }
} else {
  console.log(`  reason: ${rendered.reason ?? 'unknown'}`);
}

await closeRenderBrowser();
process.exit(0);
