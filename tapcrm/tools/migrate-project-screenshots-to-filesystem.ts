#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { getStorageService } from '../packages/server/src/platform/storage/index.js';
import { storeScreenshot, readScreenshot, removeScreenshot } from '../packages/server/src/modules/projects/reports/screenshot-file-store.js';
import type { ScreenshotMimeType } from '../packages/server/src/modules/projects/reports/screenshots.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const envFile = resolve(root, '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split('\n')) { const value = line.trim(); const index = value.indexOf('='); if (index > 0 && !value.startsWith('#')) { const key = value.slice(0, index).trim(); if (!(key in process.env)) process.env[key] = value.slice(index + 1).trim(); } }

const dryRun = process.argv.includes('--dry-run');
const connectionString = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!connectionString) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required.');
const client = new pg.Client({ connectionString });
const hash = (body: Buffer): string => createHash('sha256').update(body).digest('hex');
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
function isGeneratedPath(row: { organization_id: string; project_id: string; storage_key: string; mime_type: ScreenshotMimeType }): boolean {
  const extension = row.mime_type === 'image/jpeg' ? 'jpg' : row.mime_type.slice(6);
  return new RegExp(`^screenshots/${row.organization_id}/${row.project_id}/${uuid}\\.${extension}$`, 'i').test(row.storage_key);
}

await client.connect();
try {
  // New records use the local-filesystem namespace. Migrate every remaining
  // active record outside that namespace so older key layouts are not left
  // broken just because their prefix differed between releases.
  const rows = await client.query<{ id: string; organization_id: string; project_id: string; storage_key: string; original_filename: string; mime_type: ScreenshotMimeType; size_bytes: number }>(`SELECT id, organization_id, project_id, storage_key, original_filename, mime_type, size_bytes FROM project_screenshot WHERE deleted_at IS NULL ORDER BY created_at, id`);
  const storage = getStorageService();
  console.log(`${dryRun ? '[dry-run] ' : ''}Found ${rows.rowCount ?? 0} active screenshot record(s); legacy physical names and object-storage keys will be migrated.`);
  for (const row of rows.rows) {
    if (isGeneratedPath(row)) continue;
    let storedPath: string | undefined;
    try {
      let body: Buffer;
      try { body = await readScreenshot(row.storage_key); } catch { body = (await storage.getObject({ bucket: 'files', key: row.storage_key })).body; }
      if (body.length !== Number(row.size_bytes)) throw new Error(`Size verification failed for screenshot ${row.id}.`);
      const saved = dryRun ? null : await storeScreenshot(row.organization_id, row.project_id, row.mime_type, body);
      storedPath = saved?.relativePath;
      if (dryRun) { console.log(`would copy ${row.id} (${hash(body)})`); continue; }
      const copied = await readScreenshot(saved!.relativePath);
      if (copied.length !== body.length || hash(copied) !== hash(body)) throw new Error(`Checksum verification failed for screenshot ${row.id}.`);
      await client.query('BEGIN');
      try { await client.query('UPDATE project_screenshot SET storage_key = $1, updated_at = now() WHERE id = $2 AND storage_key = $3', [saved!.relativePath, row.id, row.storage_key]); await client.query('COMMIT'); console.log(`migrated ${row.id} (${hash(copied)})`); } catch (error) { await client.query('ROLLBACK'); throw error; }
    } catch (error) {
      if (storedPath) await removeScreenshot(storedPath);
      console.error(`could not migrate ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally { await client.end(); }
