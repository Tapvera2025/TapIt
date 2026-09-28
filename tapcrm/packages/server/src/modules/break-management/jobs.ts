import { db } from '../../platform/dal/db.js';
import { defineJob, type JobHandle } from '../../platform/jobs/runner.js';
import { lockPerson } from '../attendance/facade.js';
import * as AttFacade from '../attendance/facade.js';
import { evaluateBreakDay } from './evaluator.js';

const SCAN_PAGE = 200;

export interface BreakJobs {
  readonly evaluateItem: JobHandle<{
    recordId: string;
    calculationVersion: number;
    breaksEvaluationRevision: string;
  }>;
  readonly evaluate: JobHandle<undefined>;
}

export function registerBreakJobs(): BreakJobs {
  const evalItemJob = defineJob<{
    recordId: string;
    calculationVersion: number;
    breaksEvaluationRevision: string;
  }>({
    name: 'breaks.evaluate-item',
    perOrganization: true,
    module: 'break-management',
    attempts: 3,
    handler: async ({ ctx, payload, clock }) => {
      await db.transaction(ctx, async (tx) => {
        // Load record to get userId without the person lock
        const record = await AttFacade.loadBreakDay(tx, payload.recordId);
        if (record === null) return;
        // Take the person lock, then evaluate under it
        await lockPerson(tx, record.userId);
        await evaluateBreakDay(
          tx,
          payload.recordId,
          payload.calculationVersion,
          BigInt(payload.breaksEvaluationRevision),
          clock,
        );
      });
      return { itemsProcessed: 1 };
    },
  });

  const evalScanJob = defineJob({
    name: 'breaks.evaluate',
    perOrganization: true,
    module: 'break-management',
    schedule: { pattern: '0 * * * *' }, // hourly
    attempts: 1,
    handler: async ({ ctx, clock }) => {
      const now = clock.now();
      let afterId: string | null = null;
      let offered = 0;

      for (;;) {
        interface Offer {
          key: string;
          payload: {
            recordId: string;
            calculationVersion: number;
            breaksEvaluationRevision: string;
          };
        }
        const offers: Offer[] = [];

        await db.transaction(ctx, async (tx) => {
          const candidates = await AttFacade.breakEvaluationCandidates(
            tx,
            ctx.organizationId,
            afterId,
            SCAN_PAGE,
          );

          for (const c of candidates) {
            const baseKey = `break-eval:${c.recordId}:${c.calculationVersion}:${c.breaksEvaluationRevision}`;
            const next = await evalItemJob.nextGeneration(tx, baseKey, now);
            if (next.kind === 'run') {
              offers.push({
                key: next.key,
                payload: {
                  recordId: c.recordId,
                  calculationVersion: c.calculationVersion,
                  breaksEvaluationRevision: String(c.breaksEvaluationRevision),
                },
              });
            }
          }

          if (candidates.length > 0) {
            afterId = candidates[candidates.length - 1]!.recordId;
          }
          if (candidates.length < SCAN_PAGE) {
            afterId = null; // sentinel: done
          }
        });

        // Enqueue after commit (TX-2)
        for (const offer of offers) {
          await evalItemJob.enqueue({
            organizationId: ctx.organizationId,
            key: offer.key,
            payload: offer.payload,
          });
          offered++;
        }

        if (afterId === null) break;
      }

      return { itemsProcessed: offered };
    },
  });

  return { evaluateItem: evalItemJob, evaluate: evalScanJob };
}
