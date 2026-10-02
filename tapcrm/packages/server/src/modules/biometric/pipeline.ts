import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { organizationTimezone } from '../../platform/organization-time.js';
import { localDateOf, systemClock, type Clock } from '../../platform/time.js';
import * as AttendanceFacade from '../attendance/facade.js';
import { comparePunches, reconcile } from './bursts.js';
import { resolvePin } from './mapping.js';
import * as punches from './punch-repository.js';
import { eventOf, plausibilityOf } from './reading.js';
import * as repo from './repository.js';

/**
 * Processing one stored punch (§10.3 steps 5–9), in its own tenant
 * transaction. The punch was read once when it arrived (D37); nothing here
 * looks at today's device settings.
 *
 * Lock order (step 5 plan, Task 4): the connector/PIN lock, then the person's
 * lock, then rows in id order. Never a PIN lock after a person lock.
 */

export type ProcessResult =
  | { readonly outcome: 'skipped'; readonly status: string }
  | { readonly outcome: 'applied'; readonly eventId: string }
  | { readonly outcome: 'duplicate'; readonly headId: string }
  | { readonly outcome: 'dry-run' }
  | { readonly outcome: 'unmapped' | 'held' | 'rejected'; readonly reason: string };

export interface ProcessOptions {
  readonly clock?: Clock;
  /** An explicit replay (Task 6): waiting punches run again; `releaseHold` lets a backdated one through. */
  readonly replay?: { readonly releaseHold: boolean };
}

/** Punches a replay may run again; anything already placed stays as it is. */
const REPLAYABLE = new Set(['received', 'unmapped', 'held', 'rejected']);

export async function processPunch(
  ctx: RequestContext,
  punchId: string,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return db.transaction(ctx, (tx) => processPunchIn(tx, ctx, punchId, options));
}

/** The same, inside the caller's transaction: everything it writes commits or rolls back with it. */
export async function processPunchIn(
  tx: Tx,
  ctx: RequestContext,
  punchId: string,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const clock = options.clock ?? systemClock;
  const replayed = options.replay !== undefined;
  const seen = await punches.findPunch(tx, punchId);
  if (seen === null) return { outcome: 'skipped', status: 'missing' };
  if (!(replayed ? REPLAYABLE.has(seen.status) : seen.status === 'received'))
    return { outcome: 'skipped', status: seen.status };

  // 1. The PIN's lock: mapping writers and other punches of the PIN wait.
  await repo.lockPin(tx, seen.connectorId, seen.pin);
  const now = clock.now();

  // 2. Plausibility against the moment it arrived, so a slow queue changes nothing.
  const plausibility = plausibilityOf(
    seen.correctedAt,
    seen.receivedAt,
    seen.backfillHours,
  );
  if (plausibility === 'future') {
    return finish(
      tx,
      seen,
      { status: 'rejected', reason: 'future', clearPerson: true },
      now,
      replayed,
    );
  }
  if (plausibility === 'backdated' && options.replay?.releaseHold !== true) {
    return finish(
      tx,
      seen,
      { status: 'held', reason: 'backdated', clearPerson: true },
      now,
      replayed,
    );
  }

  // 3. Whose punch: the PIN's mapping on the punch's own date (§10.3 step 6).
  const timezone = await organizationTimezone(tx);
  const date = localDateOf(seen.correctedAt, timezone);
  const mapping = resolvePin(
    await repo.mappingsOfPin(tx, seen.connectorId, seen.pin),
    { connectorId: seen.connectorId, deviceId: seen.deviceId, pin: seen.pin },
    date,
  );
  if (mapping === null) {
    return finish(
      tx,
      seen,
      { status: 'unmapped', reason: 'no-mapping', clearPerson: true },
      now,
      replayed,
    );
  }

  // 4. The person's lock, then the row itself, read again: another worker may have finished it.
  await AttendanceFacade.lockPerson(tx, mapping.userId);
  const punch = (await punches.findPunch(tx, punchId, { forUpdate: true }))!;
  if (!(replayed ? REPLAYABLE.has(punch.status) : punch.status === 'received'))
    return { outcome: 'skipped', status: punch.status };
  await punches.setPerson(tx, punch.id, mapping.userId, mapping.id);

  if (!(await AttendanceFacade.employedOn(tx, mapping.userId, date))) {
    await repo.openReview(tx, ctx.organizationId, punch.id, 'not-employed', {
      userId: mapping.userId,
      date,
    });
    return finish(
      tx,
      punch,
      { status: 'rejected', reason: 'not-employed' },
      now,
      replayed,
    );
  }

  // 5. The duplicate burst (BI-6), then the mode (BI-5), then attendance.
  const incoming: punches.BurstMember = {
    id: punch.id,
    organizationId: punch.organizationId,
    userId: mapping.userId,
    meaning: punch.meaning,
    dryRun: punch.dryRunAtReceipt,
    correctedAt: punch.correctedAt,
    readerKey: punch.readerKey,
    externalEventId: punch.externalEventId,
    rawLine: punch.rawLine,
    deviceId: punch.deviceId,
    pin: punch.pin,
    status: 'received',
    duplicateOf: null,
    attendanceEventId: null,
  };
  const neighbours = await burstChain(tx, incoming);
  const { burst } = reconcile(neighbours, incoming);
  const members = burst.members as punches.BurstMember[];

  if (incoming.dryRun) return placeDryRun(tx, punch, members, now, replayed);
  if (burst.head.id !== incoming.id)
    return follow(tx, ctx, punch, members, now, clock, replayed);
  return lead(tx, ctx, punch, incoming, members, now, clock, replayed);
}

/**
 * Every placed punch chained to the incoming one by gaps of at most 60 seconds,
 * across devices and PINs. Widens until the chain stops growing.
 */
async function burstChain(
  tx: Tx,
  incoming: punches.BurstMember,
): Promise<punches.BurstMember[]> {
  const key = {
    userId: incoming.userId,
    meaning: incoming.meaning,
    dryRun: incoming.dryRun,
    excludeId: incoming.id,
  };
  let from = incoming.correctedAt;
  let to = incoming.correctedAt;
  for (;;) {
    const found = await punches.burstNeighbours(tx, key, from, to);
    const times = found.map((member) => member.correctedAt.getTime());
    const nextFrom = new Date(Math.min(from.getTime(), ...times));
    const nextTo = new Date(Math.max(to.getTime(), ...times));
    if (nextFrom.getTime() === from.getTime() && nextTo.getTime() === to.getTime())
      return found;
    from = nextFrom;
    to = nextTo;
  }
}

/** BI-5: a dry-run burst is placed like any other, and nothing becomes attendance. */
async function placeDryRun(
  tx: Tx,
  punch: punches.StoredPunch,
  members: readonly punches.BurstMember[],
  now: Date,
  replayed: boolean,
): Promise<ProcessResult> {
  const head = members[0]!;
  for (const member of members) {
    if (member.id === head.id || member.id === punch.id) continue;
    if (member.status !== 'duplicate' || member.duplicateOf !== head.id)
      await punches.linkToHead(tx, member.id, head.id, now);
  }
  if (head.id === punch.id) {
    await punches.finishPunch(
      tx,
      punch.id,
      { status: 'dry-run', reason: null },
      now,
      replayed,
    );
    return { outcome: 'dry-run' };
  }
  await punches.finishPunch(
    tx,
    punch.id,
    { status: 'duplicate', reason: null, duplicateOf: head.id },
    now,
    replayed,
  );
  return { outcome: 'duplicate', headId: head.id };
}

function attendanceInput(
  punch: punches.StoredPunch,
  userId: string,
): AttendanceFacade.AppendEventInput {
  return {
    userId,
    ...eventOf(punch),
    at: punch.correctedAt,
    source: 'device',
    biometricPunchId: punch.id,
    remote: false,
  };
}

/**
 * The incoming punch is the earliest of its burst, so it leads. With no
 * applied head it becomes attendance; otherwise it takes the applied head's
 * place in one step (`replaceDeviceEvent`). A head a person has corrected is
 * kept: the incoming punch waits as its duplicate, with a review item.
 */
async function lead(
  tx: Tx,
  ctx: RequestContext,
  punch: punches.StoredPunch,
  incoming: punches.BurstMember,
  members: readonly punches.BurstMember[],
  now: Date,
  clock: Clock,
  replayed: boolean,
): Promise<ProcessResult> {
  const applied = members
    .filter((member) => member.status === 'applied')
    .sort(comparePunches);
  const input = attendanceInput(punch, incoming.userId);

  let eventId: string;
  const kept = new Set<string>();
  if (applied.length === 0) {
    eventId = (await AttendanceFacade.appendEvent(tx, input, clock)).eventId;
  } else {
    const [first, ...others] = applied;
    const replaced = await AttendanceFacade.replaceDeviceEvent(
      tx,
      first!.attendanceEventId!,
      input,
      clock,
    );
    if (replaced.outcome === 'refused') {
      await repo.openReview(
        tx,
        ctx.organizationId,
        punch.id,
        reviewKindOf(replaced.reason),
        {
          headId: first!.id,
        },
      );
      await punches.finishPunch(
        tx,
        punch.id,
        { status: 'duplicate', reason: 'protected-head', duplicateOf: first!.id },
        now,
        replayed,
      );
      return { outcome: 'duplicate', headId: first!.id };
    }
    eventId = replaced.eventId;
    // Two applied heads in one burst only after a protected merge; retire what may be retired.
    for (const other of others) {
      if (!(await retireHead(tx, ctx, other, clock))) kept.add(other.id);
    }
  }
  await punches.finishPunch(
    tx,
    punch.id,
    { status: 'applied', reason: null, attendanceEventId: eventId },
    now,
    replayed,
  );
  for (const member of members) {
    if (member.id === punch.id || kept.has(member.id)) continue;
    if (member.status !== 'duplicate' || member.duplicateOf !== punch.id)
      await punches.linkToHead(tx, member.id, punch.id, now);
  }
  return { outcome: 'applied', eventId };
}

/**
 * The incoming punch follows an earlier one: it is a duplicate. Every other
 * applied head in the burst — the later head of two bursts it bridged — is
 * retired on its own (`retireEvent`) and joins the head with its duplicates.
 * The head is the earliest punch, unless a person's correction kept a later
 * one applied (a protected head); then the burst hangs from that one.
 */
async function follow(
  tx: Tx,
  ctx: RequestContext,
  punch: punches.StoredPunch,
  members: readonly punches.BurstMember[],
  now: Date,
  clock: Clock,
  replayed: boolean,
): Promise<ProcessResult> {
  const earliest = members[0]!;
  const anchor =
    earliest.status === 'duplicate'
      ? (members.find((member) => member.status === 'applied') ?? earliest)
      : earliest;

  // An applied punch never becomes a duplicate while its event stands.
  const kept = new Set<string>();
  for (const member of members) {
    if (member.status === 'applied' && member.id !== anchor.id) {
      if (!(await retireHead(tx, ctx, member, clock))) kept.add(member.id);
    }
  }
  await punches.finishPunch(
    tx,
    punch.id,
    { status: 'duplicate', reason: null, duplicateOf: anchor.id },
    now,
    replayed,
  );
  for (const member of members) {
    if (member.id === anchor.id || member.id === punch.id || kept.has(member.id))
      continue;
    // A kept head's duplicates stay with it.
    if (member.duplicateOf !== null && kept.has(member.duplicateOf)) continue;
    if (member.status !== 'duplicate' || member.duplicateOf !== anchor.id)
      await punches.linkToHead(tx, member.id, anchor.id, now);
  }
  return { outcome: 'duplicate', headId: anchor.id };
}

/**
 * Retires an applied head that no longer leads. A head whose event a person
 * already corrected is left alone, with a review item; returns false then.
 */
async function retireHead(
  tx: Tx,
  ctx: RequestContext,
  head: punches.BurstMember,
  clock: Clock,
): Promise<boolean> {
  const result = await AttendanceFacade.retireEvent(tx, head.attendanceEventId!, clock);
  if (result.retired) return true;
  await repo.openReview(tx, ctx.organizationId, head.id, 'protected-head', {
    reason: result.reason,
  });
  return false;
}

function reviewKindOf(
  reason: AttendanceFacade.ReplacementRefusal,
): 'protected-head' | 'other-person' | 'not-a-device-event' {
  return reason === 'already-superseded' ? 'protected-head' : reason;
}

async function finish(
  tx: Tx,
  punch: punches.StoredPunch,
  outcome: punches.PunchOutcome & { status: 'unmapped' | 'held' | 'rejected' },
  now: Date,
  replayed: boolean,
): Promise<ProcessResult> {
  await punches.finishPunch(tx, punch.id, outcome, now, replayed);
  return { outcome: outcome.status, reason: outcome.reason ?? '' };
}
