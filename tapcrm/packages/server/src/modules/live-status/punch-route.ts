import { z } from 'zod';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { systemClock, wholeSeconds, type Clock } from '../../platform/time.js';
import * as AttendanceFacade from '../attendance/facade.js';
import { PunchNotAllowedError } from './errors.js';
import { loadToday } from './today.js';

/**
 * POST /api/status/punch (§9.2, G1). An employee punches in or out, or starts
 * or ends a break, from the web or the app.
 *
 * Thin by design (§9.2 "Why the route is this thin"): validate the shape,
 * refuse a move the person cannot make now, and hand the rest to
 * `appendEvent` — which resolves the day, takes the person lock and writes
 * the event. The move check runs under that same lock, so two quick taps
 * cannot both punch in.
 *
 * T-5, T-6: `occurred_at` is the injected clock's `now()` truncated to whole
 * seconds. `clientTime` is stored next to it as evidence (D13) but NEVER
 * controls the attendance instant. A web punch is `remote` until a geofence
 * or WFH approval says otherwise; the day's calculation flags it.
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

const LABEL: Record<string, string> = {
  in: 'punch in',
  out: 'punch out',
  'break-start': 'start a break',
  'break-end': 'end a break',
  scan: 'scan',
};

export async function punch(
  ctx: RequestContext,
  body: unknown,
  clock: Clock = systemClock,
): Promise<AttendanceFacade.AppendEventResult> {
  const input = punchSchema.parse(body);
  const at = wholeSeconds(clock.now()); // T-5, T-6
  return db.transaction(ctx, async (tx) => {
    await AttendanceFacade.lockPerson(tx, ctx.principal.id);
    const { allowedMoves } = await loadToday(tx, ctx.principal.id, at);
    // A retry of a punch already recorded is answered by appendEvent, not refused.
    const retry = await AttendanceFacade.findClientEvent(tx, ctx.principal.id, input.clientEventId);
    if (retry === null && input.kind === 'in') {
      const workDate = await AttendanceFacade.currentDayFor(tx, ctx.principal.id, at);
      const overlays = workDate === null ? [] : await AttendanceFacade.overlaysForDay(tx, ctx.principal.id, workDate);
      if (overlays.some((overlay) => overlay.sourceKind === 'leave')) {
        throw new PunchNotAllowedError(
          'You cannot punch in because approved leave exists for today.',
          { kind: input.kind, allowedMoves: allowedMoves.filter((move) => move !== 'in') },
        );
      }
    }
    if (retry === null && !allowedMoves.includes(input.kind)) {
      throw new PunchNotAllowedError(
        `You can't ${LABEL[input.kind] ?? input.kind} right now.`,
        { kind: input.kind, allowedMoves },
      );
    }
    return AttendanceFacade.appendEvent(tx, {
      userId: ctx.principal.id,
      kind: input.kind,
      at,
      source: 'web',
      evidence: 'confirmed',
      remote: true,
      clientEventId: input.clientEventId,
      clientTime: input.clientTime ?? null,
      location: input.location ?? null,
    });
  });
}
