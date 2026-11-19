import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../platform/dal/context.js';

/** Sending a joining email: token first, then the email, then "sent". */

interface Log { steps: string[]; sent: Record<string, unknown>[]; failSend: boolean; manager: string | null }
const log = vi.hoisted((): Log => ({ steps: [], sent: [], failSend: false, manager: 'Priya Nair' }));

vi.mock('../../platform/dal/db.js', () => ({
  db: {
    transaction: vi.fn(async (_ctx: unknown, work: (t: unknown) => Promise<unknown>) => {
      log.steps.push('mark-sent');
      return work({ query: vi.fn(async () => []) });
    }),
  },
  bootstrapDb: {},
}));
vi.mock('../../config.js', () => ({
  loadConfig: () => ({ CLIENT_ORIGIN: 'https://crm.example.com', API_BASE_PATH: '/api' }),
}));
vi.mock('../identity/facade.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendEmail: vi.fn(async (message: Record<string, unknown>) => {
    log.steps.push('send');
    if (log.failSend) throw new Error('SMTP down');
    log.sent.push(message);
  }),
}));
vi.mock('./repository.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  findJoiningById: vi.fn(async () => ({ id: 'j-1', candidateId: 'c-1', offerId: 'o-1', expectedJoiningDate: '2026-12-01' })),
  findCandidateById: vi.fn(async () => ({ id: 'c-1', firstName: 'Rahul', lastName: 'Sharma', email: 'rahul@example.com' })),
  findOfferById: vi.fn(async () => ({ id: 'o-1', requisitionId: 'r-1', positionId: 'pos-1', positionName: 'Backend Engineer' })),
  findRequisitionById: vi.fn(async () => ({ id: 'r-1', title: 'Backend', departmentName: 'Engineering' })),
  findJoiningEmailFacts: vi.fn(async () => ({ organizationName: 'Acme Ltd', managerName: log.manager })),
  ensureJoiningAcknowledgeToken: vi.fn(async () => {
    log.steps.push('store-token');
    return 'tok123';
  }),
}));

const { sendJoiningEmail } = await import('./service.js');
const hr = { organizationId: '00000000-0000-4000-8000-000000000001', principal: { id: 'hr' } } as unknown as RequestContext;
const input = { subject: 'Welcome to {{company_name}}', body: '<p>Dear {{candidate_name}}, you report to {{manager_name}}.</p>' };

describe('sendJoiningEmail', () => {
  beforeEach(() => {
    log.steps = [];
    log.sent = [];
    log.failSend = false;
    log.manager = 'Priya Nair';
  });

  it('stores the token, sends HTML with the company name and manager, then marks it sent', async () => {
    await sendJoiningEmail(hr, 'j-1', input);
    expect(log.steps).toEqual(['store-token', 'send', 'mark-sent']);
    expect(log.sent[0]).toMatchObject({
      to: 'rahul@example.com',
      subject: 'Welcome to Acme Ltd',
      html: expect.stringContaining('Dear Rahul Sharma, you report to Priya Nair.'),
    });
    expect(log.sent[0]?.['html']).toContain('href="https://crm.example.com/api/public/recruitment/acknowledge/tok123"');
  });

  it('does not mark the email sent when sending fails', async () => {
    log.failSend = true;
    await expect(sendJoiningEmail(hr, 'j-1', input)).rejects.toMatchObject({ status: 502, code: 'JOINING_EMAIL_NOT_SENT' });
    expect(log.steps).toEqual(['store-token', 'send']);
  });

  it('sends nothing when a variable has no value', async () => {
    log.manager = null;
    await expect(sendJoiningEmail(hr, 'j-1', input)).rejects.toMatchObject({ status: 422, code: 'JOINING_EMAIL_TEMPLATE_INCOMPLETE' });
    expect(log.steps).toEqual([]);
  });
});
