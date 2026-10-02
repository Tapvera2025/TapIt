import { systemPrincipal, type RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { NOTIFICATION_TYPES, clip, formatDay, fullNames, notify } from '../notifications/facade.js';
import { effectiveManagerId } from '../organization/facade.js';

/**
 * Break breach notifications — the Tasks pattern (modules/tasks/notifications.ts).
 * Every call is made inside the transaction that records the breach or the
 * decision, so an evaluation or review that rolls back tells nobody.
 *
 *   event                                   who                                     type                           priority
 *   ──────────────────────────────────────  ──────────────────────────────────────  ─────────────────────────────  ─────────────
 *   breach needs an explanation             the employee                            breaks.explanation_required    operational
 *   breach applied automatically            the employee (what it did to the day    breaks.breach_applied          informational
 *     (late, half day, absent, minutes,       or their pay)
 *     amount) or a "warn" rule
 *   "notify manager" rule                   the employee's manager                  breaks.manager_notice          informational
 *   employee explains a breach              everyone who reviews breaches           breaks.explanation_submitted   operational
 *                                           (holders of breaks:review-breach)
 *   HR confirms or waives a breach          the employee                            breaks.breach_reviewed         informational
 *
 * A breach waiting for HR's review does not notify HR one by one: the Break
 * Breach Queue lists them, and a payroll run refuses to publish while any is
 * open. Re-evaluating a day that gives the same rule again tells nobody twice.
 */

const TODAY_LINK = '/company/attendance/today';
const MY_ATTENDANCE_LINK = '/company/attendance/my';
const QUEUE_LINK = '/company/breaks/queue';

export interface RuleEffect {
  readonly consequence: string | null;
  readonly minutes: number | null;
  readonly amount: string | null;
}

export interface BreakMeasure {
  readonly totalMinutes: number;
  readonly longestMinutes: number;
  readonly count: number;
}

/** What a rule does, in words: "the day is marked late", "₹200 is deducted from pay". */
export function effectOf(rule: RuleEffect): string {
  switch (rule.consequence) {
    case 'mark-late':
      return 'the day is marked late';
    case 'mark-half-day':
      return 'the day is marked a half day';
    case 'mark-absent':
      return 'the day is marked absent';
    case 'deduct-minutes':
      return `${rule.minutes ?? 0} minutes are deducted from the day`;
    case 'deduct-amount':
      return `₹${Number(rule.amount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} is deducted from pay`;
    case 'notify-manager':
      return 'your manager is told';
    case 'require-explanation':
      return 'an explanation is needed';
    default:
      return 'this is a warning';
  }
}

function usage(measure: BreakMeasure): string {
  const breaks = measure.count === 1 ? '1 break' : `${measure.count} breaks`;
  return `${breaks}, ${measure.totalMinutes} min in total, longest ${measure.longestMinutes} min`;
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Background evaluation acts as the system, so no recipient is the actor. */
function systemContext(organizationId: string): Pick<RequestContext, 'organizationId' | 'principal'> {
  return { organizationId, principal: systemPrincipal(organizationId) };
}

/**
 * A day's evaluation produced a breach under a rule. `previousRuleId` is the
 * rule of the answer this one replaces (if any): the same rule again means the
 * employee already heard about this day.
 */
export async function notifyBreachRecorded(
  tx: Tx,
  input: {
    readonly organizationId: string;
    readonly breachId: string;
    readonly userId: string;
    readonly workDate: string;
    readonly status: 'pending' | 'confirmed' | 'advisory' | 'suppressed';
    readonly rule: RuleEffect & { readonly ruleId: string };
    readonly measure: BreakMeasure;
    readonly previousRuleId: string | null;
  },
): Promise<void> {
  if (input.status !== 'pending' && input.status !== 'confirmed') return;
  if (input.previousRuleId === input.rule.ruleId) return;
  const ctx = systemContext(input.organizationId);
  const day = formatDay(input.workDate);
  const metadata = { breachId: input.breachId, workDate: input.workDate };

  if (input.rule.consequence === 'require-explanation') {
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.BREACH_EXPLANATION_REQUIRED,
      priority: 'operational',
      audience: { users: [input.userId] },
      title: clip(`Please explain your break on ${day}`, 200),
      body: clip(`${capitalise(usage(input.measure))}. Add a short note on your Today page.`, 500),
      link: TODAY_LINK,
      metadata,
    });
    return;
  }

  if (input.rule.consequence === 'notify-manager') {
    const managerId = await effectiveManagerId(tx, input.organizationId, input.userId);
    if (managerId === null) return;
    const names = await fullNames(tx, input.organizationId, [input.userId]);
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.BREACH_MANAGER_NOTICE,
      audience: { users: [managerId], excludeUserIds: [input.userId] },
      title: clip(`${names.get(input.userId) ?? 'Someone in your team'} went over the break limit on ${day}`, 200),
      body: clip(`${capitalise(usage(input.measure))}.`, 500),
      link: null,
      metadata,
    });
    return;
  }

  // Applied without review, or a plain warning: the employee should know now.
  if (input.status === 'confirmed' || input.rule.consequence === 'warn') {
    const applied = input.status === 'confirmed' ? ` Applied automatically: ${effectOf(input.rule)}.` : ' This is a warning.';
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.BREACH_APPLIED,
      audience: { users: [input.userId] },
      title: clip(`Break limit exceeded on ${day}`, 200),
      body: clip(`${capitalise(usage(input.measure))}.${applied}`, 500),
      link: MY_ATTENDANCE_LINK,
      metadata,
    });
  }
}

/** The employee explained a breach: the reviewers have something to read. */
export async function notifyBreachExplained(
  tx: Tx,
  ctx: RequestContext,
  breach: { readonly id: string; readonly userId: string; readonly workDate: string },
): Promise<void> {
  const names = await fullNames(tx, ctx.organizationId, [breach.userId]);
  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.BREACH_EXPLAINED,
    priority: 'operational',
    audience: { holders: { action: 'breaks:review-breach' }, excludeUserIds: [breach.userId] },
    title: clip(`${names.get(breach.userId) ?? 'An employee'} explained a break on ${formatDay(breach.workDate)}`, 200),
    body: 'Review it in the Break Breach Queue.',
    link: QUEUE_LINK,
    metadata: { breachId: breach.id, workDate: breach.workDate },
  });
}

/** HR decided a breach: the employee hears what it means for them. */
export async function notifyBreachReviewed(
  tx: Tx,
  ctx: RequestContext,
  breach: { readonly id: string; readonly userId: string; readonly workDate: string },
  decision: { readonly outcome: 'confirmed'; readonly rule: RuleEffect } | { readonly outcome: 'waived'; readonly reason: string },
): Promise<void> {
  if (breach.userId === ctx.principal.id) return;
  const day = formatDay(breach.workDate);
  const body =
    decision.outcome === 'confirmed'
      ? `${capitalise(effectOf(decision.rule))}.`
      : `No penalty applies.${decision.reason.trim() !== '' ? ` Note: "${decision.reason.trim()}"` : ''}`;
  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.BREACH_REVIEWED,
    audience: { users: [breach.userId] },
    title: clip(`Break breach on ${day} ${decision.outcome}`, 200),
    body: clip(body, 500),
    link: MY_ATTENDANCE_LINK,
    metadata: { breachId: breach.id, workDate: breach.workDate, outcome: decision.outcome },
  });
}
