import { defineJob, type JobHandle } from '../../platform/jobs/runner.js';
import { onOutboxEvent } from '../../platform/outbox/registry.js';
import {
  BIOMETRIC_EVENTS,
  type PunchesReceived,
  type ReplayRequested,
} from './events.js';
import { checkDeviceHealth, notifyDeviceAlert } from './health.js';
import { processPunch } from './pipeline.js';
import {
  processingKey,
  runReplayRequest,
  sweepReplayRequests,
  sweepStrandedPunches,
} from './replay.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export interface BiometricJobs {
  readonly processPunch: JobHandle<{ punchId: string }>;
  readonly replay: JobHandle<{ requestId: string }>;
  readonly sweep: JobHandle<undefined>;
  readonly health: JobHandle<undefined>;
}

/**
 * Biometric's jobs (§5.4) and outbox handlers. Work is queued only after the
 * transaction that asked for it commits (TX-2): a receipt writes
 * `biometric.punches-received`, a replay request `biometric.replay-requested`,
 * an alert `biometric.device-alert`. The sweeper recovers anything a lost
 * message or a dead worker left behind.
 */
export function registerBiometricJobs(): BiometricJobs {
  const processJob = defineJob<{ punchId: string }>({
    name: 'biometric.process-punch',
    perOrganization: true,
    module: 'biometric',
    handler: async ({ ctx, payload, clock }) => {
      const result = await processPunch(ctx, payload.punchId, { clock });
      return { itemsProcessed: result.outcome === 'skipped' ? 0 : 1 };
    },
  });

  const replayJob = defineJob<{ requestId: string }>({
    name: 'biometric.replay',
    perOrganization: true,
    module: 'biometric',
    attempts: 3,
    handler: async ({ ctx, payload, clock }) => ({
      itemsProcessed: await runReplayRequest(ctx, payload.requestId, clock),
    }),
  });

  const sweepJob = defineJob({
    name: 'biometric.sweep',
    perOrganization: true,
    module: 'biometric',
    schedule: { every: FIVE_MINUTES_MS },
    attempts: 1, // the next tick sweeps again
    handler: async ({ ctx, clock }) => {
      const now = clock.now();
      const punches = await sweepStrandedPunches(ctx, processJob, now);
      const requests = await sweepReplayRequests(ctx, replayJob, now);
      return { itemsProcessed: punches + requests };
    },
  });

  const healthJob = defineJob({
    name: 'biometric.health',
    perOrganization: true,
    module: 'biometric',
    schedule: { every: FIFTEEN_MINUTES_MS },
    attempts: 1,
    handler: async ({ ctx, clock }) => ({
      itemsProcessed: await checkDeviceHealth(ctx, clock),
    }),
  });

  // Idempotent: a job per punch and generation; a key already queued or done is skipped.
  onOutboxEvent(BIOMETRIC_EVENTS.PUNCHES_RECEIVED, async (event) => {
    for (const punchId of (event.payload as PunchesReceived).punchIds) {
      await processJob.enqueue({
        organizationId: event.organizationId,
        key: processingKey(punchId, 0),
        payload: { punchId },
      });
    }
  });

  onOutboxEvent(BIOMETRIC_EVENTS.REPLAY_REQUESTED, async (event) => {
    const { requestId } = event.payload as ReplayRequested;
    await replayJob.enqueue({
      organizationId: event.organizationId,
      key: requestId,
      payload: { requestId },
    });
  });

  onOutboxEvent(BIOMETRIC_EVENTS.DEVICE_ALERT, async (event) => {
    await notifyDeviceAlert(event);
  });

  return {
    processPunch: processJob,
    replay: replayJob,
    sweep: sweepJob,
    health: healthJob,
  };
}
