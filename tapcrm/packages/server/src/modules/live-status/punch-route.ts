import { z } from 'zod';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { systemClock, wholeSeconds, type Clock } from '../../platform/time.js';
import * as AttendanceFacade from '../attendance/facade.js';

/**
 * TODO(G1): Handler for the future POST /api/status/punch route.
 * Deliberately thin (§9.2 "Why the route is this thin"): validate shape,
 * hand to `appendEvent` — which resolves the day, takes the person
 * lock, checks WFH / arrival policy / geofence under it, and writes
 * the event.
 *
 * NOT REGISTERED. Waiting on G1 (README question 3): the registry does
 * not yet declare a `status:punch` action, so `route()` would fail the
 * boot check (RM-1). When the action lands, add one `route(...)` call in
 * `routes.ts` binding this handler — no other change needed.
 *
 * T-5, T-6: `occurred_at` is the injected clock's `now()` truncated to
 * whole seconds. `clientTime` is stored next to it as evidence (D13) but
 * NEVER controls the attendance instant.
 *
 * `location` is passed through to `appendEvent` so the arrival-policy
 * branch (§8.4 step 7, landing with step 4) can evaluate the geofence
 * against a real reading. A missing `location` is `null` — the
 * non-geofenced case.
 */

const punchSchema = z.object({
  kind: z.enum(['in', 'out', 'break-start', 'break-end', 'scan']),
  clientEventId: z.string().uuid(),
  clientTime: z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .optional(),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
      accuracyM: z.number().optional(),
    })
    .optional(),
});

export type PunchBody = z.infer<typeof punchSchema>;

export async function punch(
  ctx: RequestContext,
  body: unknown,
  clock: Clock = systemClock,
): Promise<AttendanceFacade.AppendEventResult> {
  const input = punchSchema.parse(body);
  return db.transaction(ctx, (tx) =>
    AttendanceFacade.appendEvent(tx, {
      userId: ctx.principal.id,
      kind: input.kind,
      at: wholeSeconds(clock.now()), // T-5, T-6
      source: 'web',
      evidence: 'confirmed',
      remote: true,
      clientEventId: input.clientEventId,
      clientTime: input.clientTime ?? null,
      location: input.location ?? null,
    }),
    // Step 8 (G1 gate): after a successful break move, call getAllowanceForCaller from
    // '../break-management/service.js' here inside the same transaction, and include
    // allowance/warning in this response. When G1 lands (status:punch action added to
    // registry), register the route in routes.ts and add the allowance integration here.
  );
}
