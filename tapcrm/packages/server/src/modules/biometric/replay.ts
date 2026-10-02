import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import type { GenerationDecision } from '../../platform/jobs/generation.js';
import { organizationTimezone } from '../../platform/organization-time.js';
import { systemClock, type Clock } from '../../platform/time.js';
import { processPunch } from './pipeline.js';
import * as punches from './punch-repository.js';

/**
 * Replay and recovery (step 5 plan, Task 6).
 *
 * An administrator's replay request runs through its waiting punches a page at
 * a time, keeping a cursor, so a run that dies resumes where it stopped. Each
 * punch keeps the reading it arrived with (D37); a replay may release the
 * backfill hold when asked, and nothing else: dry-run, mapping, employment and
 * impossible times still decide.
 *
 * The sweeper is the safety net behind the outbox and the queue: a punch still
 * `received` a minute after it arrived, or a request still open, is offered
 * again under its next generation. A punch whose three generations all fail is
 * held for a person, with the reason, and can be replayed.
 */

const PAGE = 100;
const SWEEP_PAGE = 200;
/** Work younger than this is still in its first delivery. */
const STRANDED_AFTER_MS = 60_000;

/** A processing job's key: the punch and its processing generation (a replay moves it on). */
export const processingKey = (punchId: string, generation: number) =>
  `${punchId}:${generation}`;

/** Runs one replay request to the end of its selection; returns how many punches it processed. */
export async function runReplayRequest(
  ctx: RequestContext,
  requestId: string,
  clock: Clock = systemClock,
): Promise<number> {
  const request = await db.transaction(ctx, (tx) => punches.startReplay(tx, requestId));
  if (request === null) return 0;
  const timezone = await db.transaction(ctx, (tx) => organizationTimezone(tx));
  let after = request.lastPunchId;
  let processed = 0;
  for (;;) {
    const cursor = after;
    const page = await db.transaction(ctx, (tx) =>
      punches.replayPage(tx, request, cursor, timezone, PAGE),
    );
    if (page.length === 0) break;
    for (const punchId of page) {
      await processPunch(ctx, punchId, {
        clock,
        replay: { releaseHold: request.releaseHold },
      });
    }
    after = page[page.length - 1]!;
    const last = after;
    await db.transaction(ctx, (tx) =>
      punches.recordReplayProgress(tx, requestId, last, page.length),
    );
    processed += page.length;
  }
  await db.transaction(ctx, (tx) =>
    punches.finishReplay(tx, requestId, 'done', clock.now(), null),
  );
  return processed;
}

/** The queues the sweeper offers work to; the jobs' own handles. */
export interface SweptQueue<P> {
  enqueue(input: { organizationId: string; key: string; payload: P }): Promise<void>;
  nextGeneration(tx: Tx, baseKey: string, now: Date): Promise<GenerationDecision>;
}

interface Offer<P> {
  readonly key: string;
  readonly payload: P;
}

/** Walks pages, one transaction each, and queues a page's offers only after it commits (TX-2). */
async function sweepInPages<P>(
  ctx: RequestContext,
  queue: SweptQueue<P>,
  page: (tx: Tx, after: string | null) => Promise<{ ids: string[]; offers: Offer<P>[] }>,
): Promise<number> {
  let after: string | null = null;
  let offered = 0;
  for (;;) {
    const cursor: string | null = after;
    const result: { ids: string[]; offers: Offer<P>[] } = await db.transaction(
      ctx,
      (tx) => page(tx, cursor),
    );
    for (const offer of result.offers)
      await queue.enqueue({ organizationId: ctx.organizationId, ...offer });
    offered += result.offers.length;
    if (result.ids.length < SWEEP_PAGE) return offered;
    after = result.ids[result.ids.length - 1]!;
  }
}

export async function sweepStrandedPunches(
  ctx: RequestContext,
  queue: SweptQueue<{ punchId: string }>,
  now: Date,
): Promise<number> {
  const before = new Date(now.getTime() - STRANDED_AFTER_MS);
  return sweepInPages(ctx, queue, async (tx, after) => {
    const rows = await punches.strandedPunches(tx, before, after, SWEEP_PAGE);
    const offers: Offer<{ punchId: string }>[] = [];
    for (const row of rows) {
      const decision = await queue.nextGeneration(
        tx,
        processingKey(row.id, row.processingGeneration),
        now,
      );
      if (decision.kind === 'run')
        offers.push({ key: decision.key, payload: { punchId: row.id } });
      // Exhausted, or a job that finished yet left the punch waiting: a person looks at it.
      if (decision.kind === 'exhausted' || decision.kind === 'done')
        await punches.finishPunch(
          tx,
          row.id,
          { status: 'held', reason: 'processing-failed', clearPerson: true },
          now,
          false,
        );
    }
    return { ids: rows.map((row) => row.id), offers };
  });
}

export async function sweepReplayRequests(
  ctx: RequestContext,
  queue: SweptQueue<{ requestId: string }>,
  now: Date,
): Promise<number> {
  const before = new Date(now.getTime() - STRANDED_AFTER_MS);
  return sweepInPages(ctx, queue, async (tx, after) => {
    const rows = await punches.openReplayRequests(tx, before, after, SWEEP_PAGE);
    const offers: Offer<{ requestId: string }>[] = [];
    for (const row of rows) {
      const decision = await queue.nextGeneration(tx, row.id, now);
      if (decision.kind === 'run')
        offers.push({ key: decision.key, payload: { requestId: row.id } });
      if (decision.kind === 'exhausted')
        await punches.finishReplay(
          tx,
          row.id,
          'failed',
          now,
          'every retry of this replay failed',
        );
    }
    return { ids: rows.map((row) => row.id), offers };
  });
}
