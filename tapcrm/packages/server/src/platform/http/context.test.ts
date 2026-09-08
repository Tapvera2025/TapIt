import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { installDevPrincipalResolver } from './dev-resolver.js';
import {
  installPrincipalResolver,
  requestContext,
} from './context.js';

const readAs = vi.hoisted(() => vi.fn());

vi.mock('../dal/db.js', () => ({
  bootstrapDb: { readAs },
}));

function request(): Request {
  return { ip: '127.0.0.1', header: () => undefined } as unknown as Request;
}

function response() {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  return {
    response: { status, json } as unknown as Response,
    status,
    json,
  };
}

function activeOrganization(): void {
  readAs.mockResolvedValue([{ status: 'active' }]);
}

describe('tenant principal resolver ownership', () => {
  it('rejects unauthenticated requests before a resolver is installed', async () => {
    const { response: res, status, json } = response();
    const next = vi.fn();

    requestContext(request(), res, next);
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith(401));

    expect(json).toHaveBeenCalledWith({
      success: false,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('uses Identity and does not allow an ordinary resolver overwrite', async () => {
    activeOrganization();
    const identityResolver = async () => ({
      organizationId: '00000000-0000-4000-8000-000000000001',
      principal: {
        id: 'identity-user',
        organizationId: '00000000-0000-4000-8000-000000000001',
        accountType: 'super-admin' as const,
        sessionVersion: 1,
      },
    });
    const replacement = async () => null;

    installPrincipalResolver(identityResolver);
    installPrincipalResolver(replacement);

    const req = request();
    const next = vi.fn();
    requestContext(req, response().response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(req.ctx?.principal.id).toBe('identity-user');
  });

  it('requires explicit opt-in before the development bypass can replace Identity', async () => {
    expect(() => installDevPrincipalResolver({ allowIdentityOverride: false })).toThrow(
      'Development bypass requires explicit IDENTITY_DEV_BYPASS=true',
    );
  });
});
