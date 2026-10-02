import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { defineJob, type JobHandle } from '../../platform/jobs/runner.js';
import { onOutboxEvent, type OutboxEvent } from '../../platform/outbox/registry.js';
import { emitAboutPerson } from '../../platform/realtime/server.js';
import { LIVE_STATUS_EVENTS, type StatusChanged } from './events.js';
import { STATUS_CHANNEL } from './channel.js';
import * as repo from './repository.js';
import { sweepRollovers } from './rollover.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export interface LiveStatusJobs {
  readonly rollover: JobHandle<undefined>;
}

/**
 * Register live-status's job (the 5-minute rollover sweeper) and its
 * outbox handler (`live-status.status-changed` → Socket.IO emit).
 *
 * The handler fires AFTER the projector's write commits (LS-8), so a
 * rolled-back transaction never leaks a `status:changed` event.
 */
export function registerLiveStatusJobs(): LiveStatusJobs {
  const rolloverJob = defineJob({
    name: 'live-status.rollover',
    perOrganization: true,
    module: 'live-status',
    schedule: { every: FIVE_MINUTES_MS },
    attempts: 1, // next tick offers the same sweep; retries buy nothing
    handler: async ({ ctx, clock }) => {
      const processed = await sweepRollovers(ctx, clock.now(), 500, clock);
      return { itemsProcessed: processed };
    },
  });

  onOutboxEvent(LIVE_STATUS_EVENTS.STATUS_CHANGED, deliverStatusChanged);

  return { rollover: rolloverJob };
}

/**
 * Tells the person's viewers their status changed. Rooms are chosen from where
 * the person sits NOW, read in a tenant context at delivery (RT-5): the row may
 * have waited through a transfer. A person no longer in the organization has
 * no audience, so nothing is sent. The client payload is exactly `{ userId }`
 * (RT-4).
 */
export async function deliverStatusChanged(event: OutboxEvent): Promise<void> {
  const change = event.payload as StatusChanged;
  const ctx = createJobContext({
    organizationId: event.organizationId,
    principal: systemPrincipal(event.organizationId),
    jobName: LIVE_STATUS_EVENTS.STATUS_CHANGED,
    runId: event.id,
  });
  const subject = await db.transaction(ctx, (tx) =>
    repo.currentRoutingSubject(tx, change.userId),
  );
  if (subject === null) return;
  emitAboutPerson(
    event.organizationId,
    STATUS_CHANNEL,
    {
      userId: subject.userId,
      departmentId: subject.departmentId,
      teamId: subject.teamId,
    },
    'status:changed',
    { userId: subject.userId },
  );
}
