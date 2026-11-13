#!/usr/bin/env tsx
/**
 * Regenerates the chat emoji picker's data file:
 *   packages/client/src/chat/emoji/emoji-data.json
 *
 * Source: emojibase-data (MIT; names/keywords from Unicode CLDR). It is not a
 * dependency of the app — install it just for this run:
 *
 *   npm install --no-save emojibase-data@16.0.3
 *   npx tsx tools/generate-chat-emoji-data.ts
 *
 * Every emoji is written in its RGI (fully-qualified) form — the exact
 * strings the server's reaction validator accepts — and only emoji from
 * Unicode 15.0 or earlier are kept, so the picker never offers one that
 * renders as an empty box on a slightly older phone or laptop.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Entry {
  label: string;
  hexcode: string;
  tags?: string[];
  group?: number;
  order?: number;
  version: number;
  skins?: { hexcode: string; tone?: number | number[]; version: number }[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'packages/client/src/chat/emoji/emoji-data.json');
const MAX_VERSION = 15;
const RGI = new RegExp('^\\p{RGI_Emoji}$', 'v');
/** emojibase group ids → picker categories (2 = skin-tone components, not shown). */
const GROUPS: Record<number, number> = { 0: 0, 1: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8 };
const GROUP_NAMES = ['Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink', 'Travel & Places', 'Activities', 'Objects', 'Symbols', 'Flags'];

function rgi(hexcode: string): string | null {
  const raw = String.fromCodePoint(...hexcode.split('-').map((part) => parseInt(part, 16)));
  if (RGI.test(raw)) return raw;
  const first = String.fromCodePoint(raw.codePointAt(0)!);
  const qualified = `${first}\uFE0F${raw.slice(first.length)}`;
  return RGI.test(qualified) ? qualified : null;
}

const require = createRequire(import.meta.url);
const data = JSON.parse(readFileSync(require.resolve('emojibase-data/en/data.json'), 'utf8')) as Entry[];

const rows: (string | number | string[])[][] = [];
for (const entry of data.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
  if (entry.group === undefined || GROUPS[entry.group] === undefined || entry.version > MAX_VERSION) continue;
  const emoji = rgi(entry.hexcode);
  if (!emoji) continue;
  const keywords = [...new Set((entry.tags ?? []).map((tag) => tag.toLowerCase()))].join(' ');
  // Single-tone variants only (two-person mixed tones would need a second picker step).
  const skins = (entry.skins ?? [])
    .filter((skin) => typeof skin.tone === 'number' && skin.version <= MAX_VERSION)
    .sort((a, b) => (a.tone as number) - (b.tone as number))
    .map((skin) => rgi(skin.hexcode))
    .filter((value): value is string => value !== null);
  const row: (string | number | string[])[] = [emoji, entry.label, keywords, GROUPS[entry.group]!];
  if (skins.length === 5) row.push(skins);
  rows.push(row);
}

writeFileSync(OUT, `${JSON.stringify({ source: 'emojibase-data 16.0.3 (MIT), Unicode <= 15.0', groups: GROUP_NAMES, emoji: rows })}\n`);
console.log(`✓ ${rows.length} emoji → ${OUT}`);
