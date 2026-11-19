import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Authz from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import type { createDeal as CreateDeal } from './service.js';

type Input = Parameters<typeof CreateDeal>[1];
interface State {
  lead: Record<string, unknown> | null;
  lineage: Record<string, unknown>;
  closerIsEmployee: boolean;
  denied: Set<string>;
}

/**
 * Who may turn a lead into a deal, and who may be named its closer.
 * Database and authorization are stubbed; the transaction is replaced by a
 * sentinel so a test can see that every check before it passed.
 */

const REACHED = new Error('reached the insert transaction');
const state = vi.hoisted((): State => ({
  lead: { id: 'lead-1', type: 'lead', organizationId: 'org-1', currentHolderId: 'agent-a', ownerId: 'agent-a' },
  lineage: { originatingAgentId: 'agent-a', currentHolderId: 'agent-a', ownerId: 'agent-a', companyId: null, contactId: 'contact-1' },
  closerIsEmployee: true,
  denied: new Set<string>(),
}));

vi.mock('../../../platform/dal/db.js', () => ({
  db: {
    maybeOne: vi.fn(async (_ctx: unknown, query: { sql: string }) => {
      if (query.sql.includes('FROM lead')) return state.lineage;
      if (query.sql.includes('FROM app_user')) return state.closerIsEmployee ? { id: 'x' } : null;
      return null;
    }),
    transaction: vi.fn(async () => {
      throw REACHED;
    }),
  },
}));
vi.mock('../leads/repository.js', () => ({
  loadLeadResource: vi.fn(async () => state.lead),
  insertActivity: vi.fn(),
  insertAudit: vi.fn(),
}));
vi.mock('@tapcrm/authz', async (original) => ({
  ...(await original<typeof Authz>()),
  authorize: vi.fn(async (_ctx: unknown, action: string) => {
    if (state.denied.has(action)) throw new Error(`denied ${action}`);
  }),
}));

const { createDeal } = await import('./service.js');

function ctx(id: string, accountType: 'employee' | 'super-admin' = 'employee'): RequestContext {
  return {
    organizationId: 'org-1',
    requestId: 'r',
    principal: {
      employee: { id, organizationId: 'org-1', sessionVersion: 1, accountType, positionId: 'p', departmentId: 'd', teamId: null, reportsTo: null, organizationalLevel: 1 },
      'super-admin': { id, organizationId: 'org-1', sessionVersion: 1, accountType },
    }[accountType],
  } as unknown as RequestContext;
}

const fromLead: Input = { originatingLeadId: 'lead-1', title: 'Clinic website', currency: 'INR' };

describe('creating a deal from a lead', () => {
  beforeEach(() => {
    state.denied = new Set();
    state.closerIsEmployee = true;
    state.lead = { id: 'lead-1', type: 'lead', organizationId: 'org-1', currentHolderId: 'agent-a', ownerId: 'agent-a' };
  });

  it('refuses an agent who cannot work the lead (a colleague\'s lead)', async () => {
    state.denied.add('leads:edit');
    await expect(createDeal(ctx('agent-b'), fromLead)).rejects.toThrow('denied leads:edit');
  });

  it('lets the lead\'s own agent convert it, with them as closer', async () => {
    await expect(createDeal(ctx('agent-a'), fromLead)).rejects.toBe(REACHED);
  });

  it('refuses naming a different closer without the right to reassign the lead', async () => {
    state.denied.add('leads:reassign');
    await expect(
      createDeal(ctx('agent-b'), { ...fromLead, responsibleCloserId: 'agent-b' }),
    ).rejects.toThrow('denied leads:reassign');
  });

  it('allows a manager who may reassign the lead to name an active employee as closer', async () => {
    await expect(
      createDeal(ctx('team-lead'), { ...fromLead, responsibleCloserId: 'agent-c' }),
    ).rejects.toBe(REACHED);
    state.closerIsEmployee = false;
    await expect(
      createDeal(ctx('team-lead'), { ...fromLead, responsibleCloserId: 'gone-user' }),
    ).rejects.toMatchObject({ code: 'DEAL_CLOSER_INVALID' });
  });

  it('refuses a contact other than the lead\'s', async () => {
    await expect(
      createDeal(ctx('agent-a'), { ...fromLead, contactId: 'someone-else' }),
    ).rejects.toMatchObject({ code: 'DEAL_CONTACT_MISMATCH' });
  });

  it('answers 404 for an unknown lead', async () => {
    state.lead = null;
    await expect(createDeal(ctx('agent-a'), fromLead)).rejects.toMatchObject({ code: 'DEAL_LEAD_NOT_FOUND' });
  });
});

describe('entering a deal directly', () => {
  const direct: Input = { directEntryReason: 'Referral', contactId: 'contact-1', title: 'Retainer', currency: 'INR' };

  it('makes the person entering it the closer', async () => {
    await expect(createDeal(ctx('agent-a'), direct)).rejects.toBe(REACHED);
  });

  it('refuses naming someone else as closer unless the caller has global access', async () => {
    await expect(
      createDeal(ctx('agent-a'), { ...direct, responsibleCloserId: 'agent-b' }),
    ).rejects.toThrow(/closed by the person who enters it/);
    await expect(
      createDeal(ctx('admin', 'super-admin'), { ...direct, responsibleCloserId: 'agent-b' }),
    ).rejects.toBe(REACHED);
  });
});
