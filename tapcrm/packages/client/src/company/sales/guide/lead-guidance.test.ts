import { describe, expect, it } from 'vitest';
import type { Handover, Lead, LeadCallback } from '../leads/api.js';
import type { Guidance } from './guidance.js';
import { isStillStalled, leadGuidance, leadRowHint, leadSteps, type LeadViewer } from './lead-guidance.js';

const NOW = new Date('2026-11-05T10:00:00.000Z');
const ME = 'user-me';
const AGENT: LeadViewer = { id: ME, canEditLead: true, canCreateDeal: true, canReassign: false };
const MANAGER: LeadViewer = { id: 'user-head', canEditLead: true, canCreateDeal: true, canReassign: true };

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1', leadNumber: '1042', contactId: null, contactName: 'Ravi Kumar', companyId: null, companyName: 'Kumar Traders',
    phone: '+91 98765 43210', email: 'ravi@example.test', sourceId: 'src', sourceName: 'Website', campaignId: null, campaignName: null,
    status: 'assigned', routingStatus: 'assigned', ownerId: ME, currentHolderId: ME, ownerName: 'Asha', currentHolderName: 'Asha',
    salesTeamName: null, territoryName: null, lossReason: null, lostAt: null, previousLeadId: null, stalledAt: null, stalledReason: null,
    createdAt: '2026-11-01T09:00:00.000Z', updatedAt: '2026-11-01T09:00:00.000Z', activities: [], bidState: 'none', bidPoolExpiresAt: null,
    ...overrides,
  };
}

function callback(overrides: Partial<LeadCallback> = {}): LeadCallback {
  return {
    id: 'cb-1', leadId: 'lead-1', leadNumber: '1042', leadContactName: 'Ravi Kumar', ownerId: ME, ownerName: 'Asha',
    scheduledAt: '2026-11-05T12:00:00.000Z', reason: null, status: 'pending', outcome: null, parentCallbackId: null,
    organizationTimezone: 'Asia/Kolkata', reminders: [], completedAt: null, missedAt: null, cancelledAt: null,
    ...overrides,
  };
}

function handover(overrides: Partial<Handover> = {}): Handover {
  return {
    id: 'ho-1', leadId: 'lead-1', fromUserId: ME, fromUserName: 'Asha', toUserId: 'user-sup', toUserName: 'Vikram',
    handoverMode: 'direct', queueClaimedAt: null, status: 'pending', disposition: null, reason: null, offeredAt: NOW.toISOString(),
    acceptedAt: null, declinedAt: null, expiredAt: null, timeToAcceptSeconds: null, timeToOutcomeSeconds: null, corrections: [],
    ...overrides,
  };
}

function guide(input: { lead?: Partial<Lead>; callbacks?: LeadCallback[]; handovers?: Handover[]; viewer?: LeadViewer; dealId?: string | null }): Guidance {
  return leadGuidance({
    lead: lead(input.lead),
    callbacks: input.callbacks ?? [],
    handovers: input.handovers ?? [],
    dealId: input.dealId ?? null,
    viewer: input.viewer ?? AGENT,
    now: NOW,
    formatWhen: (iso) => `<${iso}>`,
  });
}

const labels = (g: Guidance): string[] => g.actions.map((action) => action.label);
const primaryOf = (g: Guidance) => g.actions.find((action) => action.emphasis === 'primary');

describe('lead progress', () => {
  it('walks owner, first contact, needs and deal', () => {
    expect(leadSteps(lead({ ownerId: null, currentHolderId: null, status: 'new', routingStatus: 'unrouted' })).map((step) => step.state))
      .toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(leadSteps(lead()).map((step) => step.state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(leadSteps(lead({ status: 'discovery' })).map((step) => step.state)).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(leadSteps(lead({ status: 'follow_up' })).map((step) => step.state)).toEqual(['done', 'done', 'done', 'current']);
    expect(leadSteps(lead({ status: 'converted' })).every((step) => step.state === 'done')).toBe(true);
  });

  it('remembers how far a lost lead got from its history', () => {
    const steps = leadSteps(lead({
      status: 'closed_lost',
      activities: [{ id: 'a1', eventName: 'lead.status_changed', metadata: { from: 'assigned', to: 'contacted' }, createdAt: '2026-11-02T09:00:00.000Z' }],
    }));
    expect(steps.map((step) => [step.label, step.state])).toEqual([
      ['Owner assigned', 'done'], ['First contact', 'done'], ['Needs understood', 'skipped'], ['Closed as lost', 'lost'],
    ]);
  });
});

describe('lead guidance for the person holding the lead', () => {
  it('starts a new lead with the first call and a one-click "contacted"', () => {
    const g = guide({});
    expect(g.tone).toBe('act');
    expect(g.title).toBe('Make the first call to Ravi Kumar');
    expect(primaryOf(g)?.do).toEqual({ kind: 'command', command: { type: 'lead-status', status: 'contacted' } });
    expect(labels(g)).toContain('Call +91 98765 43210');
    expect(g.actions.find((action) => action.label === 'Call +91 98765 43210')?.do).toEqual({ kind: 'link', href: 'tel:+919876543210' });
    expect(g.waitingOn).toBe('You');
  });

  it('flags a lead the viewer just added', () => {
    expect(guide({ lead: { createdBy: ME, createdAt: '2026-11-05T09:55:00.000Z' } }).badge).toBe('Just added');
    expect(guide({ lead: { createdBy: 'someone-else', createdAt: '2026-11-05T09:55:00.000Z' } }).badge).toBeUndefined();
  });

  it('only offers status moves the API accepts', () => {
    const moves: Record<string, string | undefined> = {
      assigned: 'contacted', contacted: 'discovery', callback_scheduled: 'contacted', nurture: 'contacted',
    };
    for (const [status, next] of Object.entries(moves)) {
      const action = primaryOf(guide({ lead: { status: status as Lead['status'] } }));
      expect(action?.do).toEqual({ kind: 'command', command: { type: 'lead-status', status: next } });
    }
    expect(primaryOf(guide({ lead: { status: 'discovery' } }))?.do).toEqual({ kind: 'command', command: { type: 'convert-lead' } });
    expect(primaryOf(guide({ lead: { status: 'follow_up' } }))?.do).toEqual({ kind: 'focus', target: 'lead-callbacks' });
  });

  it('never offers a deal to someone who cannot create one', () => {
    const g = guide({ lead: { status: 'discovery' }, viewer: { ...AGENT, canCreateDeal: false } });
    expect(g.actions.some((action) => action.do.kind === 'command' && action.do.command.type === 'convert-lead')).toBe(false);
  });

  it('keeps one primary button', () => {
    for (const status of ['assigned', 'contacted', 'discovery', 'proposal_sent', 'follow_up', 'callback_scheduled', 'nurture'] as const) {
      expect(guide({ lead: { status } }).actions.filter((action) => action.emphasis === 'primary').length).toBeLessThanOrEqual(1);
    }
  });

  it('puts an overdue callback first, with the call as the main button', () => {
    const g = guide({ callbacks: [callback({ scheduledAt: '2026-11-05T09:30:00.000Z' })] });
    expect(g.badge).toBe('Overdue');
    expect(g.title).toBe('Call Ravi Kumar back now');
    expect(primaryOf(g)?.label).toBe('Call +91 98765 43210');
    expect(labels(g)).toContain('Record the outcome');
  });

  it('waits for a booked callback', () => {
    const g = guide({ callbacks: [callback()] });
    expect(g.tone).toBe('wait');
    expect(g.title).toBe('Callback booked for <2026-11-05T12:00:00.000Z>');
  });

  it('nudges a stalled lead until there is new activity', () => {
    const stalled = { stalledAt: '2026-11-04T00:00:00.000Z', stalledReason: 'inactivity', activities: [{ id: 's', eventName: 'lead.stalled', createdAt: '2026-11-04T00:00:00.000Z' }] };
    expect(guide({ lead: stalled }).badge).toBe('Stalled');
    const worked = { ...stalled, activities: [...stalled.activities, { id: 'w', eventName: 'lead.status_changed', metadata: { to: 'contacted' }, createdAt: '2026-11-04T08:00:00.000Z' }] };
    expect(isStillStalled(lead(worked))).toBe(false);
    expect(guide({ lead: worked }).badge).toBeUndefined();
  });

  it('works without a phone or email', () => {
    const g = guide({ lead: { phone: null, email: null }, callbacks: [callback({ scheduledAt: '2026-11-05T09:00:00.000Z' })] });
    expect(primaryOf(g)?.label).toBe('Record the outcome');
  });
});

describe('lead guidance for everyone else', () => {
  it('tells a colleague who has the lead and what they do next', () => {
    const g = guide({ lead: { currentHolderId: 'user-other', currentHolderName: 'Priya', ownerId: 'user-other', ownerName: 'Priya', status: 'contacted' } });
    expect(g.tone).toBe('info');
    expect(g.title).toBe('Priya is working this lead');
    expect(g.waitingOn).toBe('Priya');
    expect(g.detail).toContain('find out what they need');
    expect(g.actions).toEqual([]);
  });

  it('lets a manager reassign a quiet lead', () => {
    const g = guide({ viewer: MANAGER, lead: { stalledAt: '2026-11-04T00:00:00.000Z' } });
    expect(g.tone).toBe('act');
    expect(primaryOf(g)?.do).toEqual({ kind: 'command', command: { type: 'reassign-lead' } });
  });

  it('explains a lead waiting in the Bid Pool', () => {
    const unowned = { ownerId: null, currentHolderId: null, ownerName: null, currentHolderName: null, status: 'new' as const, routingStatus: 'unrouted' as const };
    const pool = guide({ lead: { ...unowned, bidState: 'pool_open', bidPoolExpiresAt: '2026-11-05T10:08:00.000Z' } });
    expect(pool.tone).toBe('wait');
    expect(pool.detail).toContain('by <2026-11-05T10:08:00.000Z>');
    expect(labels(pool)).toEqual(['Open the Bid Pool']);
    expect(labels(guide({ viewer: MANAGER, lead: { ...unowned, bidState: 'pool_open' } }))).toContain('Assign it now');
  });

  it('asks a manager to pick an owner for a lead in Triage', () => {
    const unowned = { ownerId: null, currentHolderId: null, status: 'new' as const, routingStatus: 'unrouted' as const, bidState: 'triage' as const };
    const g = guide({ viewer: MANAGER, lead: unowned });
    expect(g.title).toBe('Pick an owner for this lead');
    expect(g.badge).toBe('In Triage');
    expect(guide({ lead: unowned }).waitingOn).toBe('A sales manager');
  });
});

describe('live-call handovers', () => {
  it('asks the receiver to accept or decline', () => {
    const g = guide({ viewer: { ...AGENT, id: 'user-sup' }, lead: { currentHolderId: ME }, handovers: [handover()] });
    expect(g.title).toBe('Asha wants to hand you a live call');
    expect(g.actions.map((action) => action.do)).toEqual([
      { kind: 'command', command: { type: 'accept-handover', handoverId: 'ho-1' } },
      { kind: 'command', command: { type: 'decline-handover', handoverId: 'ho-1' } },
    ]);
  });

  it('tells the sender who they are waiting for', () => {
    const g = guide({ handovers: [handover()] });
    expect(g.tone).toBe('wait');
    expect(g.waitingOn).toBe('Vikram');
  });

  it('asks whoever took the call to record its outcome', () => {
    const g = guide({ viewer: { ...AGENT, id: 'user-sup' }, lead: { currentHolderId: 'user-sup' }, handovers: [handover({ status: 'accepted' })] });
    expect(g.title).toBe('Record how the call went');
    expect(primaryOf(g)?.do).toEqual({ kind: 'focus', target: 'lead-handover' });
  });
});

describe('finished leads', () => {
  it('points a converted lead at its deal', () => {
    const g = guide({ lead: { status: 'converted' }, dealId: 'deal-9' });
    expect(g.tone).toBe('done');
    expect(primaryOf(g)?.do).toEqual({ kind: 'navigate', to: '/company/sales/deals/deal-9' });
  });

  it('gives the reason a lead was lost', () => {
    const g = guide({ lead: { status: 'closed_lost', lossReason: 'no_budget' } });
    expect(g.detail).toContain('Reason: No budget.');
    expect(g.actions).toEqual([]);
  });
});

describe('leads list hints', () => {
  it('says what each lead needs next, from the viewer’s side', () => {
    expect(leadRowHint(lead(), ME)).toEqual({ label: 'Call them', urgent: true });
    expect(leadRowHint(lead({ status: 'discovery' }), ME).label).toBe('Qualify into a deal');
    expect(leadRowHint(lead({ currentHolderId: 'other', currentHolderName: 'Priya' }), ME).label).toBe('With Priya');
    expect(leadRowHint(lead({ ownerId: null, currentHolderId: null, bidState: 'triage' }), ME)).toEqual({ label: 'Needs an owner', urgent: true });
    expect(leadRowHint(lead({ status: 'converted' }), ME).label).toBe('Now a deal');
  });
});
