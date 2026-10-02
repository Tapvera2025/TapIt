import type { Tx } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import type { GenerationRow } from './generation.js';

/**
 * `job_run` — JB-1 and JB-2 (attendance design §5.4).
 *
 * One row per organization, job and key. A retry of the same key updates the
 * same row, so `attempts` counts every start — including a start that never
 * finished because the process died — and the runner can stop a job that
 * keeps killing its worker.
 */

export interface RunOutcome {
  readonly itemsProcessed?: number;
  readonly errorCount?: number;
  readonly details?: Record<string, unknown>;
}

export type BeginResult =
  | { readonly kind: 'run'; readonly attempt: number }
  | { readonly kind: 'skip'; readonly reason: 'finished' | 'dead-lettered' };

/** JB-1 — a key that finished or dead-lettered is never run again. */
export async function beginRun(
  tx: Tx,
  organizationId: string,
  jobName: string,
  key: string,
): Promise<BeginResult> {
  const started = await tx.maybeOne<{ attempts: number }>(sql`
    INSERT INTO job_run (organization_id, job_name, idempotency_key, started_at, attempts)
    VALUES (${organizationId}, ${jobName}, ${key}, now(), 1)
    ON CONFLICT (organization_id, job_name, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET attempts = job_run.attempts + 1, started_at = now(), finished_at = NULL, outcome = NULL
      WHERE job_run.dead_lettered_at IS NULL
        AND (job_run.outcome IS NULL OR job_run.outcome = 'failure')
    RETURNING attempts
  `);
  if (started !== null) return { kind: 'run', attempt: started.attempts };
  const existing = await tx.one<{ deadLetteredAt: Date | null }>(sql`
    SELECT dead_lettered_at FROM job_run
    WHERE organization_id = ${organizationId} AND job_name = ${jobName} AND idempotency_key = ${key}
  `);
  return { kind: 'skip', reason: existing.deadLetteredAt === null ? 'finished' : 'dead-lettered' };
}

export async function finishRun(
  tx: Tx,
  organizationId: string,
  jobName: string,
  key: string,
  outcome: RunOutcome,
): Promise<void> {
  const errorCount = outcome.errorCount ?? 0;
  await tx.query(sql`
    UPDATE job_run
    SET finished_at = now(),
        outcome = ${errorCount > 0 ? 'partial' : 'success'},
        items_processed = ${outcome.itemsProcessed ?? 0},
        error_count = ${errorCount},
        details = ${outcome.details === undefined ? null : JSON.stringify(outcome.details)}::jsonb
    WHERE organization_id = ${organizationId} AND job_name = ${jobName} AND idempotency_key = ${key}
  `);
}

/** JB-4 — `deadLetter` marks the key spent: no retry, no second run. */
export async function failRun(
  tx: Tx,
  organizationId: string,
  jobName: string,
  key: string,
  message: string,
  deadLetter: boolean,
): Promise<void> {
  await tx.query(sql`
    UPDATE job_run
    SET finished_at = now(),
        outcome = 'failure',
        error_count = error_count + 1,
        details = jsonb_build_object('error', ${message}::text),
        dead_lettered_at = CASE WHEN ${deadLetter} THEN now() END
    WHERE organization_id = ${organizationId} AND job_name = ${jobName} AND idempotency_key = ${key}
  `);
}

export async function generationRows(
  tx: Tx,
  jobName: string,
  keys: readonly string[],
): Promise<GenerationRow[]> {
  return tx.query<GenerationRow>(sql`
    SELECT idempotency_key AS key, outcome, dead_lettered_at
    FROM job_run
    WHERE job_name = ${jobName} AND idempotency_key = ANY(${[...keys]}::text[])
  `);
}
