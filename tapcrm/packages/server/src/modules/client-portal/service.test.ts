import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { createRequestContext } from '../../platform/dal/context.js';
import { getDashboard, getProfile, getProject, getProjects } from './service.js';

const organizationId = randomUUID();

function ctxFor(principal: Principal) {
  return createRequestContext({ organizationId, principal, requestId: 'test' });
}

const employee: Principal = {
  id: randomUUID(), organizationId, accountType: 'employee', sessionVersion: 1,
  positionId: randomUUID(), departmentId: randomUUID(), teamId: null, reportsTo: null, organizationalLevel: 1,
};

describe('client portal guard', () => {
  it.each([
    ['profile', getProfile],
    ['dashboard', getDashboard],
    ['projects', getProjects],
  ])('refuses employees on %s before touching the database', async (_name, fn) => {
    await expect(fn(ctxFor(employee))).rejects.toMatchObject({ status: 403, code: 'CLIENT_PORTAL_FORBIDDEN' });
  });

  it('refuses employees on a project lookup', async () => {
    await expect(getProject(ctxFor(employee), randomUUID())).rejects.toMatchObject({ status: 403 });
  });

  it('fails closed for a client principal with no bound client id', async () => {
    const orphan: Principal = { id: randomUUID(), organizationId, accountType: 'client', sessionVersion: 1, clientId: '' };
    await expect(getProjects(ctxFor(orphan))).rejects.toMatchObject({ status: 403 });
  });

  it('returns 404 (not 400) for a malformed project id', async () => {
    const client: Principal = { id: randomUUID(), organizationId, accountType: 'client', sessionVersion: 1, clientId: randomUUID() };
    await expect(getProject(ctxFor(client), 'not-a-uuid')).rejects.toMatchObject({ status: 404 });
  });
});
