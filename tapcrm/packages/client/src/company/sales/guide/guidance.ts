/**
 * The sales guide: what a person should do next on a sales page.
 *
 * Rules are pure functions (lead-guidance.ts, deal-guidance.ts,
 * page-guidance.ts) that turn what a page already loaded into a Guidance.
 * The coach panel (SalesGuide.tsx) only renders it, so every rule is
 * unit-tested without React. The rules never decide what is allowed: the
 * API still enforces every move, and a button the rules offer can fail
 * with the API's own message.
 */

/** Something to do, something to wait for, finished, stuck, or plain information. */
export type GuideTone = 'act' | 'wait' | 'done' | 'blocked' | 'info';

/** Lead statuses a person can move a lead to from the guide. */
export type GuideLeadStatus = 'assigned' | 'contacted' | 'discovery' | 'proposal_sent' | 'follow_up' | 'nurture';

/** Work the page performs itself (it owns the API calls and dialogs). */
export type GuideCommand =
  | { readonly type: 'lead-status'; readonly status: GuideLeadStatus }
  | { readonly type: 'convert-lead' }
  | { readonly type: 'reassign-lead' }
  | { readonly type: 'accept-handover'; readonly handoverId: string }
  | { readonly type: 'decline-handover'; readonly handoverId: string }
  | { readonly type: 'confirm-payment' }
  | { readonly type: 'record-win' }
  | { readonly type: 'add-lead' };

export type GuideDo =
  | { readonly kind: 'command'; readonly command: GuideCommand }
  /** Go to another TapIt page. */
  | { readonly kind: 'navigate'; readonly to: string }
  /** Scroll to a panel on this page (by element id) and point at it. */
  | { readonly kind: 'focus'; readonly target: string }
  /** A tel: or mailto: link. */
  | { readonly kind: 'link'; readonly href: string };

export interface GuideAction {
  readonly label: string;
  readonly emphasis: 'primary' | 'secondary' | 'danger';
  readonly do: GuideDo;
}

export type StepState = 'done' | 'current' | 'upcoming' | 'skipped' | 'lost';

export interface GuideStep {
  readonly key: string;
  readonly label: string;
  readonly state: StepState;
}

export interface Guidance {
  /** What the guide is about, e.g. "Lead #1042" or "Bid Pool". */
  readonly context: string;
  readonly tone: GuideTone;
  /** The next step, in a few words. */
  readonly title: string;
  /** Why it matters or how to do it, in a sentence or two. */
  readonly detail: string;
  /** A short tag shown above the title, e.g. "Just added" or "Overdue". */
  readonly badge?: string | undefined;
  /** Whose move it is: "You", a colleague's name, "Finance"… */
  readonly waitingOn?: string | undefined;
  readonly actions: readonly GuideAction[];
  readonly tips?: readonly string[] | undefined;
  /** Progress of this lead or deal, or where a page sits in the funnel. */
  readonly steps?: readonly GuideStep[] | undefined;
  /** "progress" for a lead or deal; "map" marks where a page sits in the funnel. */
  readonly stepsKind?: 'progress' | 'map' | undefined;
  /** The line the minimized pill shows; the title when absent. */
  readonly short?: string | undefined;
}

export function primary(label: string, todo: GuideDo): GuideAction {
  return { label, emphasis: 'primary', do: todo };
}

export function secondary(label: string, todo: GuideDo): GuideAction {
  return { label, emphasis: 'secondary', do: todo };
}

export function danger(label: string, todo: GuideDo): GuideAction {
  return { label, emphasis: 'danger', do: todo };
}

export const go = (to: string): GuideDo => ({ kind: 'navigate', to });
export const focus = (target: string): GuideDo => ({ kind: 'focus', target });
export const run = (command: GuideCommand): GuideDo => ({ kind: 'command', command });

/** A tel: link for a stored phone number, or null when there is nothing to dial. */
export function telHref(phone: string | null | undefined): string | null {
  const dialable = (phone ?? '').replace(/[^\d+]/g, '');
  return /\d{5,}/.test(dialable) ? `tel:${dialable}` : null;
}

export function mailHref(email: string | null | undefined): string | null {
  const address = (email ?? '').trim();
  return address.includes('@') ? `mailto:${address}` : null;
}

/** Only one action may lead; any later "primary" reads as a secondary button. */
export function onePrimary(actions: readonly GuideAction[]): GuideAction[] {
  let seen = false;
  return actions.map((action) => {
    if (action.emphasis !== 'primary') return action;
    if (!seen) {
      seen = true;
      return action;
    }
    return { ...action, emphasis: 'secondary' };
  });
}

/** Marks the first step that is not done as current, keeping finished and skipped ones. */
export function markCurrent(steps: ReadonlyArray<{ key: string; label: string; done: boolean; skipped?: boolean }>): GuideStep[] {
  let found = false;
  return steps.map((step) => {
    if (step.done) return { key: step.key, label: step.label, state: 'done' };
    if (step.skipped) return { key: step.key, label: step.label, state: 'skipped' };
    if (!found) {
      found = true;
      return { key: step.key, label: step.label, state: 'current' };
    }
    return { key: step.key, label: step.label, state: 'upcoming' };
  });
}

/** The guide for a lead or deal page that could not be loaded. */
export function cannotOpen(context: string, what: string, backTo: string): Guidance {
  return {
    context,
    tone: 'blocked',
    title: `This ${what} can’t be opened`,
    short: `Can’t open this ${what}`,
    detail: `It may be outside what your role can see, or it no longer exists. If you need it, ask your manager or an admin.`,
    actions: [secondary(`Back to ${what}s`, go(backTo))],
  };
}
