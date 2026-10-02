import { describe, expect, it } from 'vitest';
import { decideGeneration, generationKey, generationKeys, type GenerationRow } from './generation.js';

const BASE = 'auto-close:rec-1:v3';
const NOW = new Date('2026-09-25T10:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const deadLetter = (key: string, hours: number): GenerationRow => ({
  key,
  outcome: 'failure',
  deadLetteredAt: hoursAgo(hours),
});

describe('JB-4 — dead-lettered work comes back by generation (design §5.4)', () => {
  it('names generations base, :g2, :g3', () => {
    expect(generationKey(BASE, 1)).toBe(BASE);
    expect(generationKeys(BASE)).toEqual([BASE, `${BASE}:g2`, `${BASE}:g3`]);
  });

  it('runs generation one when nothing has run', () => {
    expect(decideGeneration(BASE, [], NOW)).toEqual({ kind: 'run', key: BASE, generation: 1 });
  });

  it('offers the same key again while it is queued, running or retrying', () => {
    const started = [{ key: BASE, outcome: null, deadLetteredAt: null }];
    const retrying = [{ key: BASE, outcome: 'failure', deadLetteredAt: null }];
    expect(decideGeneration(BASE, started, NOW)).toEqual({ kind: 'run', key: BASE, generation: 1 });
    expect(decideGeneration(BASE, retrying, NOW)).toEqual({ kind: 'run', key: BASE, generation: 1 });
  });

  it('does nothing once the key has finished', () => {
    const rows = [{ key: BASE, outcome: 'success', deadLetteredAt: null }];
    expect(decideGeneration(BASE, rows, NOW)).toEqual({ kind: 'done' });
  });

  it('waits a day after a dead letter before the next generation', () => {
    expect(decideGeneration(BASE, [deadLetter(BASE, 23)], NOW)).toEqual({ kind: 'wait' });
  });

  it('offers generation two a day after generation one dead-lettered', () => {
    expect(decideGeneration(BASE, [deadLetter(BASE, 25)], NOW)).toEqual({
      kind: 'run',
      key: `${BASE}:g2`,
      generation: 2,
    });
  });

  it('judges by the latest generation, not the first', () => {
    const rows = [deadLetter(BASE, 72), deadLetter(`${BASE}:g2`, 2)];
    expect(decideGeneration(BASE, rows, NOW)).toEqual({ kind: 'wait' });
  });

  it('stops after the third generation and hands the work to a person', () => {
    const rows = [deadLetter(BASE, 72), deadLetter(`${BASE}:g2`, 48), deadLetter(`${BASE}:g3`, 25)];
    expect(decideGeneration(BASE, rows, NOW)).toEqual({ kind: 'exhausted' });
  });

  it('ignores rows for other keys', () => {
    const rows = [deadLetter('auto-close:rec-1:v4', 99)];
    expect(decideGeneration(BASE, rows, NOW)).toEqual({ kind: 'run', key: BASE, generation: 1 });
  });
});
