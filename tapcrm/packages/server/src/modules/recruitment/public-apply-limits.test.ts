import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParseGate } from './parse-gate.js';

/**
 * Public application limits: one per email per job, a per-link hourly cap,
 * and a bound on concurrent resume parsing. Storage, parsing and the database
 * are stubbed; the order of the steps is what is under test.
 */

const state = vi.hoisted(() => ({
  steps: [] as string[],
  duplicate: false,
  rateAllowed: true,
}));

vi.mock('./repository.js', () => ({
  resolvePublicApplicationLink: vi.fn(async () => ({
    link: { id: 'link-1', organizationId: 'org-1', status: 'active', expiresAt: null, requisitionId: 'req-1' },
    requisition: { id: 'req-1', organizationId: 'org-1', status: 'open' },
  })),
  findSubmissionByEmailPreAuth: vi.fn(async () => {
    state.steps.push('duplicate-check');
    return state.duplicate ? { id: 'earlier' } : null;
  }),
  createResumeSubmissionPreAuth: vi.fn(async () => {
    state.steps.push('insert');
    return { id: 'sub-1', status: 'submitted' };
  }),
}));
vi.mock('./parser.js', () => ({
  parseResume: vi.fn(async () => {
    state.steps.push('parse');
    return {};
  }),
}));
vi.mock('./storage.js', () => ({
  validateResumeUpload: vi.fn(() => ({ valid: true })),
  generateResumeObjectKey: vi.fn(() => 'key'),
  getStorageService: () => ({ putObject: vi.fn(async () => { state.steps.push('store'); }) }),
}));
vi.mock('../../platform/security/rate-limit.js', () => ({
  consumeRateLimit: vi.fn(async () => {
    state.steps.push('rate-limit');
    return { allowed: state.rateAllowed, count: 1, retryAfterSeconds: 60 };
  }),
}));

const service = await import('./service.js');

const input = {
  firstName: 'Asha',
  lastName: 'Rao',
  email: ' Asha@Example.com ',
  phone: null,
  resumeBase64: Buffer.from('%PDF-1.4 resume').toString('base64'),
  resumeFilename: 'asha.pdf',
  resumeMimeType: 'application/pdf',
};

describe('public application', () => {
  beforeEach(() => {
    state.steps = [];
    state.duplicate = false;
    state.rateAllowed = true;
  });

  it('checks the cap and duplicates, then parses, then stores, then saves', async () => {
    await expect(service.submitPublicApplication('token', input)).resolves.toMatchObject({ submissionId: 'sub-1' });
    expect(state.steps).toEqual(['rate-limit', 'duplicate-check', 'parse', 'store', 'insert']);
  });

  it('refuses a second application from the same email without parsing or storing', async () => {
    state.duplicate = true;
    await expect(service.submitPublicApplication('token', input)).rejects.toMatchObject({
      status: 409,
      code: 'APPLICATION_ALREADY_SUBMITTED',
    });
    expect(state.steps).toEqual(['rate-limit', 'duplicate-check']);
  });

  it('refuses beyond the per-link hourly cap before reading the file', async () => {
    state.rateAllowed = false;
    await expect(service.submitPublicApplication('token', input)).rejects.toMatchObject({
      status: 429,
      code: 'APPLICATIONS_RATE_LIMITED',
    });
    expect(state.steps).toEqual(['rate-limit']);
  });
});

describe('ParseGate', () => {
  it('runs at most N at once, queues a few, and turns the rest away', async () => {
    const gate = new ParseGate(1, 1);
    let release!: () => void;
    const first = gate.run(() => new Promise<string>((resolve) => { release = () => resolve('first'); }));
    const second = gate.run(async () => 'second'); // queued
    await expect(gate.run(async () => 'third')).rejects.toMatchObject({ status: 503, code: 'APPLICATIONS_BUSY' });
    release();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    await expect(gate.run(async () => 'later')).resolves.toBe('later');
  });

  it('frees its slot when the work fails', async () => {
    const gate = new ParseGate(1, 0);
    await expect(gate.run(async () => { throw new Error('bad pdf'); })).rejects.toThrow('bad pdf');
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });
});
