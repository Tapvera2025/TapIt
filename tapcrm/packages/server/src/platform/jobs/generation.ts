/**
 * Generations — attendance design §5.4.
 *
 * A key that has used up its retries dead-letters, and the queue will not take
 * that key again. A sweeper that later finds the same work still undone may
 * offer it under the key's next generation (`…:g2`, `…:g3`), no sooner than a
 * day after the last failure and at most three generations in all; after that
 * the work is flagged for a person. Work whose inputs changed has a new key and
 * starts again at generation one. This is how "never retry every hour" (L5) and
 * "never forget an open day" (L6, D21) hold at the same time.
 */

export const MAX_GENERATIONS = 3;
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/** What `job_run` says about one key: its outcome, and when it dead-lettered. */
export interface GenerationRow {
  readonly key: string;
  readonly outcome: string | null;
  readonly deadLetteredAt: Date | null;
}

export type GenerationDecision =
  /**
   * Enqueue the work under this key. When the key is already queued, running
   * or waiting to retry, the queue holds it already and ignores the second
   * add, so offering it again is harmless — and it brings back a job that
   * Redis lost.
   */
  | { readonly kind: 'run'; readonly key: string; readonly generation: number }
  /** The key finished. There is nothing to do. */
  | { readonly kind: 'done' }
  /** The latest generation dead-lettered less than a day ago. */
  | { readonly kind: 'wait' }
  /** Three generations dead-lettered: a person must look at it. */
  | { readonly kind: 'exhausted' };

export function generationKey(base: string, generation: number): string {
  return generation === 1 ? base : `${base}:g${generation}`;
}

export function generationKeys(base: string): string[] {
  return Array.from({ length: MAX_GENERATIONS }, (_, i) => generationKey(base, i + 1));
}

export function decideGeneration(
  base: string,
  rows: readonly GenerationRow[],
  now: Date,
): GenerationDecision {
  let latest = 0;
  let latestRow: GenerationRow | undefined;
  for (let generation = 1; generation <= MAX_GENERATIONS; generation += 1) {
    const row = rows.find((r) => r.key === generationKey(base, generation));
    if (row !== undefined) {
      latest = generation;
      latestRow = row;
    }
  }
  if (latestRow === undefined) return { kind: 'run', key: base, generation: 1 };
  if (latestRow.outcome !== null && latestRow.outcome !== 'failure') return { kind: 'done' };
  if (latestRow.deadLetteredAt === null) return { kind: 'run', key: latestRow.key, generation: latest };
  if (latest >= MAX_GENERATIONS) return { kind: 'exhausted' };
  if (now.getTime() - latestRow.deadLetteredAt.getTime() < RETRY_AFTER_MS) return { kind: 'wait' };
  return { kind: 'run', key: generationKey(base, latest + 1), generation: latest + 1 };
}
