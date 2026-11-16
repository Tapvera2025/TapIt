import { describe, expect, it } from 'vitest';
import type { Deal, ReadinessReport, UnmetCondition } from '../deals/api.js';
import type { CommercialsState } from '../proposals/api.js';
import type { DeliveryBriefState } from '../delivery/api.js';
import type { Guidance } from './guidance.js';
import { dealGuidance, dealSteps, type DealGuideInput, type DealViewer } from './deal-guidance.js';

const CLOSER: DealViewer = { id: 'user-closer', canConfirmPayment: false, canRecordWin: false, isManager: false };
const HEAD: DealViewer = { id: 'user-head', canConfirmPayment: true, canRecordWin: true, isManager: true };

function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 'deal-1', organizationId: 'org', dealNumber: '77', originatingLeadId: 'lead-1', directEntryReason: null, contactId: 'c', contactName: 'Ravi',
    companyId: null, companyName: null, serviceRequested: null, title: 'Kumar Traders website', scopeSummary: null,
    originatingAgentId: 'user-closer', originatingAgentName: 'Asha', responsibleCloserId: 'user-closer', responsibleCloserName: 'Asha',
    closedById: null, currency: 'INR', expectedCloseAt: null, probabilityOverride: null, commercialsId: null, dealStage: 'discovery',
    approvalStatus: 'not_required', contractStatus: 'not_required', paymentStatus: 'unpaid', lifecycleStatus: 'open', lossReason: null,
    lostAt: null, wonAt: null, cancelledAt: null, createdBy: 'user-closer', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const unmet = (...conditions: UnmetCondition['condition'][]): ReadinessReport => ({
  canClose: conditions.length === 0,
  unmet: conditions.map((condition) => ({ condition, description: condition, resolver: `resolve ${condition}` })),
});

function guide(input: Partial<Omit<DealGuideInput, 'deal'>> & { deal?: Partial<Deal>; versions?: CommercialsState[]; approvals?: Array<string | null>; briefState?: DeliveryBriefState | null }): Guidance {
  return dealGuidance({
    deal: deal(input.deal),
    readiness: input.readiness ?? null,
    commercials: (input.versions ?? []).map((state, index) => ({ version: index + 1, state, approvalState: input.approvals?.[index] ?? null })),
    brief: input.briefState === undefined ? null : input.briefState === null ? null : { state: input.briefState },
    myApproval: input.myApproval ?? false,
    viewer: input.viewer ?? CLOSER,
    formatWhen: (iso) => `<${iso}>`,
    access: input.access,
  });
}

const primaryOf = (g: Guidance) => g.actions.find((action) => action.emphasis === 'primary');

describe('deal guidance', () => {
  it('starts with building the proposal', () => {
    const g = guide({ readiness: unmet('commercials', 'payment', 'delivery_brief', 'authority') });
    expect(g.title).toBe('Build the proposal');
    expect(primaryOf(g)?.do).toEqual({ kind: 'navigate', to: '/company/sales/deals/deal-1/proposals' });
    expect(g.waitingOn).toBe('You');
  });

  it('asks a salesperson to send a draft for approval before publishing', () => {
    const g = guide({ versions: ['draft'], readiness: unmet('commercials', 'payment', 'delivery_brief', 'authority') });
    expect(g.title).toBe('Send the proposal for approval');
    expect(g.waitingOn).toBe('You');
  });

  it('asks to publish a draft once that version is approved', () => {
    expect(guide({ versions: ['draft'], approvals: ['approved'], deal: { approvalStatus: 'approved' }, readiness: unmet('commercials', 'payment', 'delivery_brief', 'authority') }).title).toBe('Publish the proposal');
  });

  it('asks again for approval when the approved version was changed', () => {
    const g = guide({ versions: ['draft'], approvals: ['invalidated'], readiness: unmet('commercials', 'payment', 'delivery_brief', 'authority') });
    expect(g.title).toBe('Send the proposal for approval');
    expect(g.detail).toContain('needs approving again');
  });

  it('lets a Super Admin publish a draft directly', () => {
    const g = guide({ versions: ['draft'], viewer: { ...HEAD, publishesDirectly: true }, readiness: unmet('commercials', 'payment', 'delivery_brief') });
    expect(g.title).toBe('Publish the proposal');
    expect(g.waitingOn).toBe('You');
  });

  it('waits on the approver while approval is pending', () => {
    const g = guide({ versions: ['draft'], deal: { approvalStatus: 'pending' }, readiness: unmet('commercials', 'approval', 'payment', 'delivery_brief', 'authority') });
    expect(g.tone).toBe('wait');
    expect(g.waitingOn).toBe('The approver');
  });

  it('asks for a revision after a rejection', () => {
    expect(guide({ versions: ['draft'], deal: { approvalStatus: 'rejected' }, readiness: unmet('commercials', 'approval', 'authority') }).title).toBe('Revise the proposal');
  });

  it('prefers work the viewer can do over waiting on Finance', () => {
    const g = guide({ versions: ['published'], deal: { commercialsId: 'cm-1' }, readiness: unmet('payment', 'delivery_brief', 'authority') });
    expect(g.title).toBe('Write the delivery brief');
    expect(g.tips?.[0]).toContain('the advance payment');
  });

  it('lets Finance confirm the advance in one click', () => {
    const g = guide({ viewer: { ...CLOSER, canConfirmPayment: true }, versions: ['published'], deal: { commercialsId: 'cm-1' }, readiness: unmet('payment', 'authority'), briefState: 'draft' });
    expect(primaryOf(g)?.do).toEqual({ kind: 'command', command: { type: 'confirm-payment' } });
  });

  it('waits for the Sales Head once everything else is in place', () => {
    const g = guide({ versions: ['published'], deal: { commercialsId: 'cm-1', paymentStatus: 'advance_confirmed' }, readiness: unmet('authority'), briefState: 'draft' });
    expect(g.tone).toBe('wait');
    expect(g.waitingOn).toBe('The Sales Head');
  });

  it('offers the win to someone who can record it', () => {
    const g = guide({ viewer: HEAD, versions: ['published'], deal: { commercialsId: 'cm-1', paymentStatus: 'advance_confirmed' }, readiness: unmet(), briefState: 'draft' });
    expect(g.title).toBe('Record the win');
    expect(primaryOf(g)?.do).toEqual({ kind: 'command', command: { type: 'record-win' } });
  });

  it('asks the approver to decide first', () => {
    const g = guide({ viewer: HEAD, myApproval: true, deal: { approvalStatus: 'pending' }, readiness: unmet('commercials', 'approval') });
    expect(g.title).toBe('Your approval is needed');
    expect(primaryOf(g)?.do).toEqual({ kind: 'focus', target: 'deal-decision' });
  });

  it('turns the closer’s work into a wait for a colleague who only watches the deal', () => {
    const g = guide({ viewer: { ...CLOSER, id: 'user-other' }, readiness: unmet('commercials', 'authority') });
    expect(g.tone).toBe('wait');
    expect(g.waitingOn).toBe('Asha');
    expect(g.actions.every((action) => action.emphasis !== 'primary')).toBe(true);
  });

  it('works from the deal fields when the readiness check did not load', () => {
    const g = guide({ deal: { commercialsId: 'cm-1', approvalStatus: 'approved', paymentStatus: 'advance_confirmed' }, briefState: null });
    expect(g.title).toBe('Write the delivery brief');
  });

  it('shows a won deal as done', () => {
    const g = guide({ deal: { lifecycleStatus: 'won', wonAt: '2026-11-04T10:00:00.000Z' } });
    expect(g.tone).toBe('done');
    expect(g.detail).toContain('<2026-11-04T10:00:00.000Z>');
  });
});

describe('deal progress', () => {
  it('marks approval as not needed once a proposal is out without one', () => {
    const steps = dealSteps({ deal: deal({ commercialsId: 'cm-1' }), readiness: unmet('payment', 'delivery_brief'), commercials: [], brief: null, myApproval: false, viewer: CLOSER, formatWhen: String });
    expect(steps.map((step) => [step.key, step.state])).toEqual([
      ['proposal', 'done'], ['approval', 'skipped'], ['advance', 'current'], ['brief', 'upcoming'], ['won', 'upcoming'],
    ]);
  });

  it('adds the contract step only when a contract is required', () => {
    const base = { readiness: null, commercials: [], brief: null, myApproval: false, viewer: CLOSER, formatWhen: String };
    expect(dealSteps({ ...base, deal: deal() }).some((step) => step.key === 'contract')).toBe(false);
    expect(dealSteps({ ...base, deal: deal({ contractStatus: 'draft' }) }).some((step) => step.key === 'contract')).toBe(true);
  });

  it('ends a lost deal on "Lost"', () => {
    const steps = dealSteps({ deal: deal({ lifecycleStatus: 'lost' }), readiness: null, commercials: [], brief: null, myApproval: false, viewer: CLOSER, formatWhen: String });
    expect(steps.at(-1)).toEqual({ key: 'won', label: 'Lost', state: 'lost' });
    expect(steps.some((step) => step.state === 'current')).toBe(false);
  });
});

describe('deal guidance when a page is closed to the viewer', () => {
  it('asks an admin instead of sending the viewer to a proposal they cannot open', () => {
    const g = guide({ access: { proposals: false, brief: true }, readiness: unmet('commercials', 'payment', 'delivery_brief') });
    expect(g.tone).toBe('blocked');
    expect(g.waitingOn).toBe('An admin');
    expect(g.actions).toEqual([]);
  });

  it('does the same for the delivery brief', () => {
    const g = guide({ access: { proposals: true, brief: false }, versions: ['published'], deal: { commercialsId: 'cm-1', paymentStatus: 'advance_confirmed' }, readiness: unmet('delivery_brief') });
    expect(g.title).toBe('Your role can’t open the delivery brief');
  });
});
