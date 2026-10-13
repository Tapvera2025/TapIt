/**
 * Sales v1.1 — intake and bidding job registrations (PRD §6, §8).
 *
 * R0 scaffolding. Handlers are deliberately thin stubs that log + no-op;
 * R1 steps 1.1 (intake service), 1.3 (bidding), 1.7 (Meta adapter) fill
 * them in. The job definitions ship now so:
 *
 *   - the queue names are stable from day one
 *   - the service layer can call `.enqueue({ key, payload })` immediately
 *   - the BullMQ schedulers are provisioned before adapters go live
 *
 * Each handler MUST stay idempotent on its key (JB-1): at-least-once
 * delivery is a guarantee, and processing the same key twice must have
 * the same effect as processing it once. The service layer owns the
 * uniqueness; the handler trusts the key.
 */

import { defineJob, type JobHandle } from '../../../platform/jobs/runner.js';

export interface IngestJobPayload {
  readonly submissionId: string;
}

/**
 * Scheduled sweep payload. `tick` is the schedule tick instant; the
 * actual target is every pool_open lead whose expiry has elapsed.
 */
export interface BidPoolExpireJobPayload {
  readonly tick?: string;
}

export interface MetaReconcileJobPayload {
  readonly connectorId?: string;
  readonly tick?: string;
}

export interface MetaFetchLeadPayload {
  readonly connectorId: string;
  readonly leadgenId: string;
  readonly formId: string | null;
  readonly createdTime: string | null;
}

export interface PayloadCleanupPayload {
  readonly olderThanDays?: number;
}

/**
 * Default retention for raw intake payloads when the scheduled sweep fires
 * without an explicit override. The BullMQ scheduler enqueues `{ tick: true }`
 * (no payload), so the handler must have a fallback.
 */
const DEFAULT_PAYLOAD_RETENTION_DAYS = 90;

/**
 * One-off intake job: processes a `lead_submission` row that was
 * durably stored by a connector route handler. Key = submission id so
 * webhook replays enqueue once.
 *
 * R1 step 1.1 — fill in: normalise payload, dedupe, classify, route,
 * create lead, write routing_decision.
 */
export let intakeIngestJob: JobHandle<IngestJobPayload>;

/**
 * Delayed expiry job per `pool_open` lead. Key = leadId so re-emission
 * (e.g., after a stage advance) collapses into one delayed job.
 *
 * R1 step 1.3 — fill in: load lead inside tx, if still `pool_open`,
 * try fallback assignment or move to triage.
 */
export let bidPoolExpireJob: JobHandle<BidPoolExpireJobPayload>;

/**
 * Per-organization, every 15 minutes: for each active Meta connector,
 * fetch recent form responses and cross-check against submissions. Key
 * is the schedule tick's instant so a double-tick is one effective run.
 *
 * R1 step 1.7 — fill in: iterate connectors, call Graph API, enqueue
 * intake jobs for new leadgen_ids.
 */
export let metaReconcileJob: JobHandle<MetaReconcileJobPayload>;

/**
 * Per-lead Graph fetch. Enqueued by the Meta webhook handler and by the
 * reconcile sweep. Key = leadgen_id so Meta's at-least-once webhook
 * delivery collapses to one effective fetch.
 *
 * R1 step 1.7 — the handler loads the connector, calls the Graph API,
 * normalises `field_data` and hands off to `ingest()`.
 */
export let metaFetchLeadJob: JobHandle<MetaFetchLeadPayload>;

/**
 * Platform job (not per-org), daily: null out `raw_payload_encrypted`
 * on `lead_submission` rows older than 30 days. The row itself stays
 * — only the raw payload is zeroed. Key = date so one run per day.
 *
 * R1 step 1.1 hardening — fill in: UPDATE ... SET raw_payload_encrypted
 * = NULL WHERE source_received_at < now() - interval '30 days'.
 */
export let payloadCleanupJob: JobHandle<PayloadCleanupPayload>;

export function registerSalesIntakeJobs(): void {
  intakeIngestJob = defineJob<IngestJobPayload>({
    name: 'sales.intake.ingest',
    perOrganization: true,
    attempts: 8,
    handler: async ({ payload, attempt }) => {
      // R1 step 1.1 fills this in. Logging only for now so the scheduler
      // and queue plumbing can be observed in staging without producing
      // partial writes.
      console.info(
        JSON.stringify({
          level: 'info',
          msg: 'sales.intake.ingest noop (R0 scaffolding)',
          submissionId: payload.submissionId,
          attempt,
        }),
      );
    },
  });

  bidPoolExpireJob = defineJob<BidPoolExpireJobPayload>({
    name: 'sales.bid-pool.expire',
    perOrganization: true,
    schedule: { every: 30 * 1000 },
    attempts: 5,
    handler: async ({ ctx, attempt }) => {
      // Dynamic import keeps the circular edge intake ↔ bidding one-way.
      const { sweepExpired } = await import('../bidding/service.js');
      const expired = await sweepExpired(ctx);
      if (expired > 0 || attempt > 1) {
        console.info(
          JSON.stringify({
            level: 'info',
            msg: 'sales.bid-pool.expire swept',
            organizationId: ctx.organizationId,
            expired,
            attempt,
          }),
        );
      }
    },
  });

  metaReconcileJob = defineJob<MetaReconcileJobPayload>({
    name: 'sales.intake.meta-reconcile',
    perOrganization: true,
    schedule: { every: 15 * 60 * 1000 },
    attempts: 3,
    handler: async ({ ctx, attempt }) => {
      const { runMetaReconcileForOrganization } = await import('../adapters/meta/worker.js');
      const result = await runMetaReconcileForOrganization(ctx);
      if (result.enqueued > 0 || attempt > 1) {
        console.info(
          JSON.stringify({
            level: 'info',
            msg: 'sales.intake.meta-reconcile swept',
            organizationId: ctx.organizationId,
            connectors: result.connectorsConsidered,
            enqueued: result.enqueued,
            errors: result.errors,
            attempt,
          }),
        );
      }
    },
  });

  metaFetchLeadJob = defineJob<MetaFetchLeadPayload>({
    name: 'sales.intake.meta-fetch-lead',
    perOrganization: true,
    attempts: 5,
    handler: async ({ ctx, payload, attempt }) => {
      const { runMetaFetchLeadJob } = await import('../adapters/meta/worker.js');
      const outcome = await runMetaFetchLeadJob(ctx, payload);
      if (outcome !== 'ingested' || attempt > 1) {
        console.info(
          JSON.stringify({
            level: 'info',
            msg: 'sales.intake.meta-fetch-lead handled',
            organizationId: ctx.organizationId,
            leadgenId: payload.leadgenId,
            outcome,
            attempt,
          }),
        );
      }
    },
  });

  payloadCleanupJob = defineJob<PayloadCleanupPayload>({
    name: 'sales.intake.cleanup-raw-payloads',
    perOrganization: false,
    schedule: { every: 24 * 60 * 60 * 1000 },
    attempts: 3,
    handler: async ({ payload, attempt }) => {
      const olderThanDays = payload?.olderThanDays ?? DEFAULT_PAYLOAD_RETENTION_DAYS;
      console.info(
        JSON.stringify({
          level: 'info',
          msg: 'sales.intake.cleanup-raw-payloads noop (R0 scaffolding)',
          olderThanDays,
          attempt,
        }),
      );
    },
  });
}
