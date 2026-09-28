import { authorize } from '@tapcrm/authz';
import type { DateOnly } from '@tapcrm/contracts';
import { readDay } from '@tapcrm/contracts';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationToday } from '../../platform/organization-time.js';
import { systemClock, wholeSeconds, type Clock } from '../../platform/time.js';
import { ensureDayRecord } from './day-open.js';
import {
  ATTENDANCE_ERROR_CODES,
  AttendanceForbiddenError,
  AttendanceNotFoundError,
  AttendanceUnprocessableError,
} from './errors.js';
import { ATTENDANCE_EVENTS } from './events.js';
import { applyCloseDecision, eligibilityForDay, reattribute } from './ledger.js';
import * as repo from './repository.js';
import type { ApproveBody, BulkCorrectionBody, RaiseCorrectionBody, RequestCorrectionBody } from './validators.js';

/**
 * Correction service — §12.
 *
 * Every write takes the person's advisory lock first (D24).
 * Creation paths enforce AT-10 and scope via a dated resource.
 * Approval enforces A1, G4 and AT-10 inside the lock.
 */

// ── Outbox helpers ─────────────────────────────────────────────────────────

async function writeCorrectionDecided(
  tx: Tx,
  organizationId: string,
  row: repo.CorrectionRow,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${ATTENDANCE_EVENTS.CORRECTION_DECIDED},
            ${JSON.stringify({
              correctionId: row.id,
              userId: row.userId,
              workDate: row.workDate,
              kind: row.kind,
              status: row.status,
              requestedBy: row.requestedBy,
              decidedBy: row.decidedBy,
            })}::jsonb)
  `);
}

async function writeAuditEntry(
  tx: Tx,
  ctx: RequestContext,
  row: repo.CorrectionRow,
  action: string,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'access', ${JSON.stringify({
      action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'attendanceCorrection',
      targetId: row.id,
      before: null,
      after: {
        userId: row.userId,
        workDate: row.workDate,
        kind: row.kind,
        status: row.status,
        requestedBy: row.requestedBy,
        decidedBy: row.decidedBy,
        reason: row.reason,
      },
      reason: row.reason,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}

// ── Authorization helper ────────────────────────────────────────────────────

async function authorizeSubject(
  ctx: RequestContext,
  tx: Tx,
  userId: string,
  workDate: DateOnly,
  action: 'attendance:raise-correction' | 'attendance:request-correction',
  clock: Clock,
): Promise<void> {
  const subject = await repo.findCorrectionSubject(tx, userId);
  if (subject === null)
    throw new AttendanceNotFoundError(
      ATTENDANCE_ERROR_CODES.EVENT_NOT_FOUND,
      'Subject employee not found.',
    );
  const today = await organizationToday(tx, clock);
  await authorize(ctx, action, {
    type: 'attendanceCorrection',
    id: userId,
    userId: subject.id,
    organizationId: subject.organizationId,
    departmentId: subject.departmentId,
    teamId: subject.teamId,
    workDate,
    organizationToday: today,
  });
}

// ── Readability check ────────────────────────────────────────────────────────

/**
 * For add/replace: build a provisional event list and verify readDay accepts the proposed event.
 * Correction-source events are eligible regardless of the window (§12 D33).
 */
async function checkReadability(
  tx: Tx,
  userId: string,
  workDate: DateOnly,
  kind: 'in' | 'out' | 'break-start' | 'break-end',
  at: Date,
  targetEventId: string | null,
): Promise<void> {
  const eligibility = await eligibilityForDay(tx, userId, workDate);
  const existing = await repo.effectiveEventsOfRecord(
    tx,
    // We need the recordId for the day — look it up
    await (async () => {
      const record = await repo.findRecordForClosure(tx, userId, workDate);
      return record?.id ?? '';
    })(),
    { excludeAutoOut: true },
  );
  const provisional = existing
    .filter((e) => e.id !== targetEventId)
    .map((e): import('@tapcrm/contracts').AttendanceEventInput => ({
      id: e.id,
      kind: e.kind,
      at: e.occurredAt.toISOString(),
      source: e.source,
      evidence: e.evidence,
      assignmentReason: (e.reason ?? 'midpoint') as import('@tapcrm/contracts').AssignmentReason,
    }));

  const proposed: import('@tapcrm/contracts').AttendanceEventInput = {
    id: 'proposed',
    kind,
    at: at.toISOString(),
    source: 'correction',
    evidence: 'confirmed',
    assignmentReason: 'correction',
  };
  provisional.push(proposed);

  const reading = readDay(provisional, eligibility);
  if (reading.notApplied.has('proposed'))
    throw new AttendanceUnprocessableError(
      ATTENDANCE_ERROR_CODES.CORRECTION_NOT_READABLE,
      'The proposed correction event is not readable in the day\'s context.',
    );
}

// ── Public API ────────────────────────────────────────────────────────────────

/** POST /api/attendance/corrections — raise on behalf of another person. */
export async function raiseCorrection(
  ctx: RequestContext,
  body: RaiseCorrectionBody,
  clock: Clock = systemClock,
): Promise<{ correctionId: string }> {
  const correctionId = await db.transaction(ctx, async (tx) => {
    await authorizeSubject(ctx, tx, body.userId, body.workDate, 'attendance:raise-correction', clock);

    const organizationId = (await tx.one<{ id: string }>(sql`SELECT current_organization_id() AS id`)).id;

    if (body.kind === 'add-event' || body.kind === 'replace-event') {
      const { kind, at } = body.payload as { kind: 'in' | 'out' | 'break-start' | 'break-end'; at: string };
      const targetEventId = body.kind === 'replace-event'
        ? (body.payload as { targetEventId: string }).targetEventId
        : null;
      await checkReadability(tx, body.userId, body.workDate, kind, wholeSeconds(new Date(at)), targetEventId);
    }

    return repo.insertCorrection(tx, {
      organizationId,
      userId: body.userId,
      workDate: body.workDate,
      kind: body.kind,
      payload: body.payload,
      reason: body.reason,
      requestedBy: ctx.principal.id,
    });
  });
  return { correctionId };
}

/** POST /api/attendance/corrections/request — employee self-request. */
export async function requestCorrection(
  ctx: RequestContext,
  body: RequestCorrectionBody,
  clock: Clock = systemClock,
): Promise<{ correctionId: string }> {
  const userId = ctx.principal.id;
  const correctionId = await db.transaction(ctx, async (tx) => {
    await authorizeSubject(ctx, tx, userId, body.workDate, 'attendance:request-correction', clock);

    const organizationId = (await tx.one<{ id: string }>(sql`SELECT current_organization_id() AS id`)).id;

    if (body.kind === 'add-event' || body.kind === 'replace-event') {
      const { kind, at } = body.payload as { kind: 'in' | 'out' | 'break-start' | 'break-end'; at: string };
      const targetEventId = body.kind === 'replace-event'
        ? (body.payload as { targetEventId: string }).targetEventId
        : null;
      await checkReadability(tx, userId, body.workDate, kind, wholeSeconds(new Date(at)), targetEventId);
    }

    return repo.insertCorrection(tx, {
      organizationId,
      userId,
      workDate: body.workDate,
      kind: body.kind,
      payload: body.payload,
      reason: body.reason,
      requestedBy: userId,
    });
  });
  return { correctionId };
}

/** POST /api/attendance/corrections/:id/approve — decide under the person's lock. */
export async function approveCorrection(
  ctx: RequestContext,
  correctionId: string,
  body: ApproveBody,
  clock: Clock = systemClock,
): Promise<{ correctionId: string }> {
  await db.transaction(ctx, async (tx) => {
    // Read once to learn the user ID, then lock.
    const peek = await repo.findCorrectionById(tx, correctionId);
    if (peek === null)
      throw new AttendanceNotFoundError(
        ATTENDANCE_ERROR_CODES.CORRECTION_NOT_FOUND,
        'Correction not found.',
      );

    await repo.lockPerson(tx, peek.userId);
    const correction = await repo.findCorrectionForUpdate(tx, correctionId);
    if (correction === null)
      throw new AttendanceNotFoundError(
        ATTENDANCE_ERROR_CODES.CORRECTION_NOT_FOUND,
        'Correction not found.',
      );
    if (correction.status !== 'pending')
      throw new AttendanceUnprocessableError(
        ATTENDANCE_ERROR_CODES.INVALID_CORRECTION_STATUS,
        `Cannot decide a correction in status '${correction.status}'.`,
      );

    const decider = ctx.principal.id;

    // A1: requester cannot approve their own correction.
    if (decider === correction.requestedBy)
      throw new AttendanceForbiddenError(
        ATTENDANCE_ERROR_CODES.CORRECTION_NOT_READABLE,
        'A1: the requester cannot approve their own correction.',
      );
    // G4: subject cannot approve a correction to their own day.
    if (decider === correction.userId)
      throw new AttendanceForbiddenError(
        ATTENDANCE_ERROR_CODES.CORRECTION_NOT_READABLE,
        'G4: the subject cannot approve a correction to their own day.',
      );

    const organizationId = (await tx.one<{ id: string }>(sql`SELECT current_organization_id() AS id`)).id;
    const today = await organizationToday(tx, clock);
    const subject = await repo.findCorrectionSubject(tx, correction.userId);

    // Re-authorize under the locked resource (A1, P9 again, after acquiring the lock).
    await authorize(ctx, 'attendance:correct', {
      type: 'attendanceCorrection',
      id: correctionId,
      userId: correction.userId,
      organizationId,
      departmentId: subject?.departmentId ?? null,
      teamId: subject?.teamId ?? null,
      workDate: correction.workDate,
      requestedBy: correction.requestedBy,
      organizationToday: today,
    });

    const additionalTouchedRecordIds = new Set<string>();

    if (correction.kind === 'void-event' || correction.kind === 'replace-event') {
      const payload = correction.payload as { targetEventId: string };
      const target = await repo.findEffectiveEvent(tx, correction.userId, payload.targetEventId);
      if (target === null || target.workDate !== correction.workDate)
        throw new AttendanceUnprocessableError(
          ATTENDANCE_ERROR_CODES.CORRECTION_TARGET_SUPERSEDED,
          'The target event has been superseded or belongs to a different work date.',
        );
      if (target.recordId !== null) additionalTouchedRecordIds.add(target.recordId);
    }

    if (correction.kind === 'confirm-as-is') {
      const payload = correction.payload as { reviewItemId: string };
      const updated = await tx.maybeOne<{ id: string }>(sql`
        UPDATE attendance_review_item
        SET resolved_at        = now(),
            resolved_by        = ${decider},
            resolution_source  = 'human',
            correction_id      = ${correctionId}
        WHERE id             = ${payload.reviewItemId}
          AND user_id        = ${correction.userId}
          AND work_date      = ${correction.workDate}
          AND resolved_at IS NULL
        RETURNING id
      `);
      if (updated === null)
        throw new AttendanceUnprocessableError(
          ATTENDANCE_ERROR_CODES.INVALID_CORRECTION_STATUS,
          'The review item does not exist, is already resolved, or does not match this correction.',
        );
    } else {
      // Materialize the day record if needed.
      const { recordId } = await ensureDayRecord(tx, correction.userId, correction.workDate, { emitRecalc: false });
      if (recordId === null)
        throw new AttendanceUnprocessableError(
          ATTENDANCE_ERROR_CODES.CORRECTION_OUT_OF_SCOPE,
          'The subject is not employed on the correction date.',
        );

      if (correction.kind === 'add-event' || correction.kind === 'replace-event') {
        const payload = correction.payload as { kind: 'in' | 'out' | 'break-start' | 'break-end'; at: string; targetEventId?: string };
        const at = wholeSeconds(new Date(payload.at));

        if (correction.kind === 'replace-event') {
          const target = await repo.findEffectiveEvent(tx, correction.userId, (payload as { targetEventId: string }).targetEventId);
          if (target === null || target.workDate !== correction.workDate)
            throw new AttendanceUnprocessableError(
              ATTENDANCE_ERROR_CODES.CORRECTION_TARGET_SUPERSEDED,
              'The target event has been superseded or belongs to a different work date.',
            );
          if (target.recordId !== null) additionalTouchedRecordIds.add(target.recordId);

          // Void the target.
          await repo.insertEvent(tx, {
            organizationId,
            userId: correction.userId,
            kind: target.kind,
            occurredAt: target.occurredAt,
            source: 'system',
            evidence: target.evidence,
            supersedesEventId: target.id,
            isVoid: true,
          });
        }

        // Insert the correction event.
        const newEventId = await repo.insertEvent(tx, {
          organizationId,
          userId: correction.userId,
          kind: payload.kind,
          occurredAt: at,
          source: 'correction',
          evidence: 'confirmed',
          correctionId,
          recordedBy: decider,
        });

        // Pin to the named record.
        await repo.assign(tx, {
          organizationId,
          userId: correction.userId,
          eventId: newEventId,
          recordId,
          reason: 'correction',
          pinned: true,
        });

        additionalTouchedRecordIds.add(recordId);
      } else if (correction.kind === 'void-event') {
        const payload = correction.payload as { targetEventId: string };
        const target = await repo.findEffectiveEvent(tx, correction.userId, payload.targetEventId);
        if (target === null || target.workDate !== correction.workDate)
          throw new AttendanceUnprocessableError(
            ATTENDANCE_ERROR_CODES.CORRECTION_TARGET_SUPERSEDED,
            'The target event has been superseded or belongs to a different work date.',
          );
        if (target.recordId !== null) additionalTouchedRecordIds.add(target.recordId);

        await repo.insertEvent(tx, {
          organizationId,
          userId: correction.userId,
          kind: target.kind,
          occurredAt: target.occurredAt,
          source: 'correction',
          evidence: target.evidence,
          supersedesEventId: target.id,
          isVoid: true,
          correctionId,
          recordedBy: decider,
        });
      }

      additionalTouchedRecordIds.add(recordId);
      const { touchedDates } = await reattribute(
        tx, correction.userId, [correction.workDate],
        { additionalTouchedRecordIds },
      );
      const closureDates = new Set<DateOnly>([...touchedDates, correction.workDate]);
      for (const date of [...closureDates].sort()) {
        await applyCloseDecision(tx, correction.userId, date, clock);
      }
    }

    await repo.updateCorrectionStatus(tx, correctionId, {
      status: 'approved',
      decidedBy: decider,
      decidedAt: clock.now(),
      decisionNote: body.decisionNote ?? null,
    });

    const decided = await repo.findCorrectionById(tx, correctionId);
    await writeCorrectionDecided(tx, organizationId, decided!);
    await writeAuditEntry(tx, ctx, decided!, 'attendance:correct');
  });

  return { correctionId };
}

/** POST /api/attendance/corrections/bulk — grouped pending creation. */
export async function bulkCorrection(
  ctx: RequestContext,
  body: BulkCorrectionBody,
  clock: Clock = systemClock,
): Promise<{ batchId: string; count: number }> {
  const batchId = randomUUID();
  const sorted = [...new Set(body.userIds)].sort();

  const count = await db.transaction(ctx, async (tx) => {
    const organizationId = (await tx.one<{ id: string }>(sql`SELECT current_organization_id() AS id`)).id;

    // Authorize every subject before inserting any row.
    for (const userId of sorted) {
      await authorizeSubject(ctx, tx, userId, body.workDate, 'attendance:raise-correction', clock);
    }

    for (const userId of sorted) {
      await repo.insertCorrection(tx, {
        organizationId,
        userId,
        workDate: body.workDate,
        kind: 'add-event',
        payload: body.payload,
        reason: body.reason,
        batchId,
        requestedBy: ctx.principal.id,
      });
    }
    return sorted.length;
  });

  return { batchId, count };
}
