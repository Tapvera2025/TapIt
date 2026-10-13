import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { setupEmployeePassword, verifyEmployeeSetupToken } from './setup.js';
import { sendEmployeeInvitation } from './notifications/invitation-email.js';
import * as mailer from './notifications/mailer.js';
import { bootstrapDb, db, platformDb, type Tx } from '../../platform/dal/db.js';
import { hashToken } from '../../platform/auth/crypto.js';
import { IdentityNotFoundError, IdentityValidationError } from './errors.js';
import * as repo from './repository.js';
import { verifyIdentityPassword } from './password/service.js';

beforeAll(() => {
  process.env['DATABASE_URL'] = 'postgresql://tapcrm_app:test@localhost:5432/tapcrm_test';
  process.env['REDIS_URL'] = 'redis://localhost:6379';
  process.env['JWT_ACCESS_SECRET'] = 'test-secret-at-least-32-chars-long-access';
  process.env['JWT_REFRESH_SECRET'] = 'test-secret-at-least-32-chars-long-refresh';
  process.env['CLIENT_ORIGIN'] = 'http://localhost:5173';
});

describe('employee setup link email delivery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('constructs the secure setup URL with token and org code', async () => {
    const sendMailSpy = vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);

    const url = await sendEmployeeInvitation({
      email: 'alex@example.com',
      fullName: 'Alex Smith',
      invitationToken: 'test-secure-setup-token-1234567890',
      organizationCode: 'ACME',
      expiresHours: 72,
    });

    expect(url).toBe('http://localhost:5173/employee/setup?token=test-secure-setup-token-1234567890&org=ACME');
    expect(sendMailSpy).toHaveBeenCalledTimes(1);

    const callArg = sendMailSpy.mock.calls[0]![0];
    expect(callArg.to).toBe('alex@example.com');
    expect(callArg.subject).toBe('TapCRM — Employee Account Setup');
    expect(callArg.text).toContain(url);
    expect(callArg.text).toContain('72 hours');
    // Ensure no password or sensitive credentials leaked in email
    expect(callArg.text).not.toContain('initialPassword');
    expect(callArg.text).not.toContain('TempPass');
  });
});

describe('employee password setup endpoint (pre-auth)', () => {
  const token = 'valid-setup-token-for-test-32charslong';
  const orgCode = 'TESTORG';
  const orgId = randomUUID();
  const userId = randomUUID();
  const tokenId = randomUUID();

  function mockReq(body: Record<string, unknown>): Request {
    return {
      body,
      query: {},
      params: {},
    } as unknown as Request;
  }

  function mockRes(): Response {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects request when organization code is missing', async () => {
    const req = mockReq({ token, password: 'StrongPassword123!' });
    const res = mockRes();

    await expect(setupEmployeePassword(req, res)).rejects.toBeInstanceOf(IdentityValidationError);
  });

  it('rejects request when organization does not exist', async () => {
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue(null);

    const req = mockReq({ token, org: orgCode, password: 'StrongPassword123!' });
    const res = mockRes();

    await expect(setupEmployeePassword(req, res)).rejects.toBeInstanceOf(IdentityNotFoundError);
  });

  it('rejects request when company is suspended', async () => {
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue({
      id: orgId,
      code: orgCode,
      name: 'Test Org',
      status: 'suspended',
    });

    const req = mockReq({ token, org: orgCode, password: 'StrongPassword123!' });
    const res = mockRes();

    await expect(setupEmployeePassword(req, res)).rejects.toMatchObject({
      code: 'IDENTITY_ORGANIZATION_SUSPENDED',
    });
  });

  it('rejects setup when token is invalid or not found', async () => {
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue({
      id: orgId,
      code: orgCode,
      name: 'Test Org',
      status: 'active',
    });
    vi.spyOn(bootstrapDb, 'readAs').mockResolvedValue([]);

    const req = mockReq({ token, org: orgCode, password: 'StrongPassword123!' });
    const res = mockRes();

    await expect(setupEmployeePassword(req, res)).rejects.toMatchObject({
      code: 'IDENTITY_SETUP_TOKEN_NOT_FOUND',
    });
  });

  it('rejects setup when token has already been used (one-time use)', async () => {
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue({
      id: orgId,
      code: orgCode,
      name: 'Test Org',
      status: 'active',
    });
    vi.spyOn(bootstrapDb, 'readAs').mockResolvedValue([
      {
        id: tokenId,
        userId,
        expiresAt: new Date(Date.now() + 3600 * 1000),
        usedAt: new Date(),
        revokedAt: null,
        email: 'employee@example.com',
        fullName: 'Jane Doe',
        userStatus: 'active',
      },
    ]);

    const req = mockReq({ token, org: orgCode, password: 'StrongPassword123!' });
    const res = mockRes();

    await expect(setupEmployeePassword(req, res)).rejects.toMatchObject({
      code: 'IDENTITY_SETUP_TOKEN_ALREADY_USED',
    });
  });

  it('rejects setup when token has expired', async () => {
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue({
      id: orgId,
      code: orgCode,
      name: 'Test Org',
      status: 'active',
    });
    vi.spyOn(bootstrapDb, 'readAs').mockResolvedValue([
      {
        id: tokenId,
        userId,
        expiresAt: new Date(Date.now() - 3600 * 1000), // expired 1 hour ago
        usedAt: null,
        revokedAt: null,
        email: 'employee@example.com',
        fullName: 'Jane Doe',
        userStatus: 'active',
      },
    ]);

    const req = mockReq({ token, org: orgCode, password: 'StrongPassword123!' });
    const res = mockRes();

    await expect(setupEmployeePassword(req, res)).rejects.toMatchObject({
      code: 'IDENTITY_SETUP_TOKEN_EXPIRED',
    });
  });

  it('rejects setup when token has been revoked', async () => {
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue({
      id: orgId,
      code: orgCode,
      name: 'Test Org',
      status: 'active',
    });
    vi.spyOn(bootstrapDb, 'readAs').mockResolvedValue([
      {
        id: tokenId,
        userId,
        expiresAt: new Date(Date.now() + 3600 * 1000),
        usedAt: null,
        revokedAt: new Date(),
        email: 'employee@example.com',
        fullName: 'Jane Doe',
        userStatus: 'active',
      },
    ]);

    const req = mockReq({ token, org: orgCode, password: 'StrongPassword123!' });
    const res = mockRes();

    await expect(setupEmployeePassword(req, res)).rejects.toMatchObject({
      code: 'IDENTITY_SETUP_TOKEN_EXPIRED',
    });
  });

  it('rejects password shorter than 12 characters', async () => {
    const req = mockReq({ token, org: orgCode, password: 'short' });
    const res = mockRes();

    await expect(setupEmployeePassword(req, res)).rejects.toThrow();
  });

  it('successfully sets permanent password, consumes token, and invalidates sessions', async () => {
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue({
      id: orgId,
      code: orgCode,
      name: 'Test Org',
      status: 'active',
    });
    vi.spyOn(bootstrapDb, 'readAs').mockResolvedValue([
      {
        id: tokenId,
        userId,
        expiresAt: new Date(Date.now() + 3600 * 1000),
        usedAt: null,
        revokedAt: null,
        email: 'employee@example.com',
        fullName: 'Jane Doe',
        userStatus: 'active',
      },
    ]);

    const fakeIdentityUser = {
      id: userId,
      organizationId: orgId,
      accountType: 'employee' as const,
      email: 'employee@example.com',
      passwordHash: 'old_hash',
      status: 'active' as const,
      organizationStatus: 'active' as const,
      sessionVersion: 1,
      mustChangePassword: true,
      lockedUntil: null,
      fullName: 'Jane Doe',
      positionId: null,
      departmentId: null,
      teamId: null,
      reportsTo: null,
      clientId: null,
      geofenceRequired: false,
      organizationalLevel: 20,
    };

    vi.spyOn(repo, 'findUserById').mockResolvedValue(fakeIdentityUser);

    const executedQueries: { sql: string; params: readonly unknown[] }[] = [];
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => {
      const mockTx: Tx = {
        maybeOne: vi.fn().mockImplementation(async (sqlObj: { sql: string; parameters: readonly unknown[] }) => {
          executedQueries.push({ sql: sqlObj.sql, params: sqlObj.parameters });
          return { id: tokenId };
        }),
        query: vi.fn().mockImplementation(async (sqlObj: { sql: string; parameters: readonly unknown[] }) => {
          executedQueries.push({ sql: sqlObj.sql, params: sqlObj.parameters });
          return [];
        }),
        one: vi.fn(),
      };
      return fn(mockTx);
    });

    const req = mockReq({ token, org: orgCode, password: 'BrandNewPermanentPass123!' });
    const statusSpy = vi.fn().mockReturnThis();
    const jsonSpy = vi.fn().mockReturnThis();
    const res = { status: statusSpy, json: jsonSpy } as unknown as Response;

    await setupEmployeePassword(req, res);

    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining('Permanent password set successfully'),
        data: expect.objectContaining({
          email: 'employee@example.com',
          fullName: 'Jane Doe',
        }),
      }),
    );

    // Verify token was marked used_at
    expect(executedQueries.some((q) => q.sql.includes('UPDATE employee_setup_token') && q.sql.includes('used_at = now()'))).toBe(true);

    // Verify app_user password_hash updated, must_change_password cleared, session_version incremented
    const updateAppUser = executedQueries.find((q) => q.sql.includes('UPDATE app_user'));
    expect(updateAppUser).toBeDefined();
    expect(updateAppUser!.sql).toContain('must_change_password = false');
    expect(updateAppUser!.sql).toContain('session_version = session_version + 1');
    const newHash = updateAppUser!.params[0] as string;
    const isValid = await verifyIdentityPassword(newHash, 'BrandNewPermanentPass123!');
    expect(isValid).toBe(true);

    // Verify sessions revoked
    expect(executedQueries.some((q) => q.sql.includes('UPDATE session') && q.sql.includes('revoked_at = now()'))).toBe(true);

    // Verify audit event written to audit_outbox with employee.password_set
    expect(
      executedQueries.some(
        (q) =>
          q.sql.includes('INSERT INTO audit_outbox') &&
          q.params.some((p) => typeof p === 'string' && p.includes('employee.password_set')),
      ),
    ).toBe(true);
  });
});

describe('employee setup link pre-flight verification', () => {
  const token = 'valid-setup-token-for-test-32charslong';
  const tokenHash = hashToken(token);
  const orgCode = 'TESTORG';
  const orgId = randomUUID();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns valid: true and metadata for active setup link', async () => {
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue({
      id: orgId,
      code: orgCode,
      name: 'Acme Corp',
      status: 'active',
    });
    vi.spyOn(bootstrapDb, 'readAs').mockResolvedValue([
      {
        id: 'tok-1',
        userId: 'u-1',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        usedAt: null,
        revokedAt: null,
        email: 'test@acme.com',
        fullName: 'Test Employee',
        userStatus: 'active',
      },
    ]);

    const req = { query: { token, org: orgCode } } as unknown as Request;
    const statusSpy = vi.fn().mockReturnThis();
    const jsonSpy = vi.fn().mockReturnThis();
    const res = {
      status: statusSpy,
      json: jsonSpy,
    } as unknown as Response;

    await verifyEmployeeSetupToken(req, res);

    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith({
      success: true,
      data: {
        valid: true,
        email: 'test@acme.com',
        fullName: 'Test Employee',
        organizationName: 'Acme Corp',
        organizationCode: 'TESTORG',
      },
    });
  });

  it('rejects verification if token was already used', async () => {
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue({
      id: orgId,
      code: orgCode,
      name: 'Acme Corp',
      status: 'active',
    });
    vi.spyOn(bootstrapDb, 'readAs').mockResolvedValue([
      {
        id: 'tok-1',
        userId: 'u-1',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        usedAt: new Date(),
        revokedAt: null,
        email: 'test@acme.com',
        fullName: 'Test Employee',
        userStatus: 'active',
      },
    ]);

    const req = { query: { token, org: orgCode } } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    await expect(verifyEmployeeSetupToken(req, res)).rejects.toMatchObject({
      code: 'IDENTITY_SETUP_TOKEN_ALREADY_USED',
    });
  });

  it('rejects verification if token was revoked', async () => {
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue({
      id: orgId,
      code: orgCode,
      name: 'Acme Corp',
      status: 'active',
    });
    vi.spyOn(bootstrapDb, 'readAs').mockResolvedValue([
      {
        id: 'tok-1',
        userId: 'u-1',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        usedAt: null,
        revokedAt: new Date(),
        email: 'test@acme.com',
        fullName: 'Test Employee',
        userStatus: 'active',
      },
    ]);

    const req = { query: { token, org: orgCode } } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    await expect(verifyEmployeeSetupToken(req, res)).rejects.toMatchObject({
      code: 'IDENTITY_SETUP_TOKEN_EXPIRED',
    });
  });

  it('rejects verification if token query parameter is missing', async () => {
    const req = { query: { org: orgCode } } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    await expect(verifyEmployeeSetupToken(req, res)).rejects.toThrow();
  });

  it('ensures raw plaintext token is never queried directly, only the SHA-256 hash', async () => {
    const readAsSpy = vi.spyOn(bootstrapDb, 'readAs').mockResolvedValue([]);
    vi.spyOn(platformDb, 'maybeOne').mockResolvedValue({
      id: orgId,
      code: orgCode,
      name: 'Acme Corp',
      status: 'active',
    });

    const req = { query: { token, org: orgCode } } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    await expect(verifyEmployeeSetupToken(req, res)).rejects.toMatchObject({
      code: 'IDENTITY_SETUP_TOKEN_NOT_FOUND',
    });

    expect(readAsSpy).toHaveBeenCalledTimes(1);
    const queryFragment = readAsSpy.mock.calls[0]![1];
    expect(queryFragment.parameters).not.toContain(token);
    expect(queryFragment.parameters.some((p) => Buffer.isBuffer(p) && p.equals(tokenHash))).toBe(true);
  });
});

