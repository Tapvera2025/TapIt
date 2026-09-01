import type { Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { route } from '../../platform/http/route.js';
import { RequestValidationError } from '../../platform/http/auth-error.js';
import {
  signup,
  login,
  completeMfaChallenge,
  logout,
  refresh,
  me,
  verifyEmail,
} from './service.js';

import {
  loginSchema,
  signupSchema,
  mfaChallengeSchema,
  mfaConfirmSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  createGeofenceSchema,
  updateGeofenceSchema,
  assignGeofenceSchema,
  verifyEmailSchema,
  geofenceBypassRequestSchema,
  serviceAccountCreateSchema,
  mfaPasskeyOptionsSchema,
  wfhApprovalSchema,
  wfhRevokeSchema,
} from './validation.js';

import {
  requestPasswordReset,
  resetPasswordWithToken,
  changePassword,
} from './password.js';

import {
  listUserMfaEnrollments,
  startTotpEnrollment,
  confirmTotpEnrollment,
  revokeMfaEnrollment,
} from './mfa.js';

import {
  listUserSessions,
  revokeSingleSession,
  revokeOtherSessions,
} from './sessions.js';

import {
  listGeofenceLocations,
  createGeofenceLocation,
  updateGeofenceLocation,
  assignGeofenceLocation,
  getUserGeofenceStatus,
  requestGeofenceBypass,
  listGeofenceBypassRequests,
  decideGeofenceBypass,
  approveWfhDay,
  revokeWfhDay,
} from './geofence.js';

import { unlockUserAccount } from './security.js';
import {
  startPasskeyRegistration,
  finishPasskeyRegistration,
  startPasskeyAuthentication,
  finishPasskeyAuthentication,
  listUserPasskeys,
  revokePasskey,
} from './mfa.js';
import {
  createServiceAccount,
  rotateServiceAccountCredential,
  disableServiceAccount,
} from './service.js';
import { verifyMfaChallengeToken } from './token.js';

const ACCESS_COOKIE = 'tapcrm_access';
const REFRESH_COOKIE = 'tapcrm_refresh';

function requestMeta(req: Request) {
  const configHeader = process.env.GEOIP_COUNTRY_HEADER || 'x-country-code';
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? null,
    userAgent: req.get('user-agent') ?? null,
    countryCode: req.get(configHeader)?.trim().toUpperCase() || null,
  };
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  const accessMaxAge = 60 * 60 * 1000;
  const refreshMaxAge = 14 * 24 * 60 * 60 * 1000;
  const secure = process.env['NODE_ENV'] === 'production';

  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: accessMaxAge,
  });

  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: refreshMaxAge,
  });
}

function clearAuthCookies(res: Response): void {
  const secure = process.env['NODE_ENV'] === 'production';

  res.clearCookie(ACCESS_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  });

  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/auth',
  });
}

export function identityCsrfMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const safe = ['GET', 'HEAD', 'OPTIONS'];
  const exempt = [
    '/api/auth/login',
    '/api/auth/signup',
    '/api/auth/verify-email',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/mfa/challenge',
  ];
  let token = req.cookies?.tapcrm_csrf as string | undefined;
  if (!token) {
    token = randomBytes(32).toString('base64url');
    res.cookie('tapcrm_csrf', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
  }
  if (safe.includes(req.method) || exempt.includes(req.path)) {
    next();
    return;
  }
  const supplied = req.get('x-csrf-token');
  if (
    !supplied ||
    supplied.length !== token.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
  ) {
    res
      .status(403)
      .json({
        success: false,
        error: { code: 'CSRF_FAILED', message: 'CSRF validation failed' },
      });
    return;
  }
  next();
}

export function registerIdentityRoutes(): void {
  /* =========================================================================
   * Public Authentication Endpoints
   * ========================================================================= */

  /*
   * POST /api/auth/signup
   */
  route({
    method: 'POST',
    path: '/api/auth/signup',
    public: true,
    status: 201,
    handler: async ({ body }) => {
      const parsed = signupSchema.safeParse(body);

      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      return signup(parsed.data);
    },
  });

  /*
   * POST /api/auth/verify-email
   */
  route({
    method: 'POST',
    path: '/api/auth/verify-email',
    public: true,
    status: 200,
    handler: async ({ body }) => {
      const parsed = verifyEmailSchema.safeParse(body);

      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      return verifyEmail(parsed.data.token);
    },
  });
  /*
   * POST /api/auth/login
   */
  route({
    method: 'POST',
    path: '/api/auth/login',
    public: true,
    status: 200,
    handler: async ({ body, req, res }) => {
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      const result = await login(parsed.data, requestMeta(req));

      if (result.mfaRequired === true) {
        return {
          mfaRequired: true,
          mfaToken: result.mfaToken,
          requiresHighAssurance: result.requiresHighAssurance,
          availableMethods: result.availableMethods,
        };
      }

      setAuthCookies(res, result.accessToken, result.refreshToken);

      return {
        mfaRequired: false,
        user: result.user,
      };
    },
  });

  /*
   * POST /api/auth/mfa/challenge
   */
  route({
    method: 'POST',
    path: '/api/auth/mfa/challenge',
    public: true,
    status: 200,
    handler: async ({ body, req, res }) => {
      const parsed = mfaChallengeSchema.safeParse(body);
      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      const result = await completeMfaChallenge(parsed.data, requestMeta(req));
      setAuthCookies(res, result.accessToken, result.refreshToken);

      return {
        user: result.user,
      };
    },
  });

  /*
   * POST /api/auth/refresh
   */
  route({
    method: 'POST',
    path: '/api/auth/refresh',
    public: true,
    status: 200,
    handler: async ({ req, res }) => {
      const refreshToken = req.cookies?.[REFRESH_COOKIE];
      const result = await refresh(refreshToken ?? '', requestMeta(req));

      setAuthCookies(res, result.accessToken, result.refreshToken);

      return {
        user: result.user,
      };
    },
  });

  /*
   * POST /api/auth/forgot-password
   */
  route({
    method: 'POST',
    path: '/api/auth/forgot-password',
    public: true,
    status: 200,
    handler: async ({ body }) => {
      const parsed = forgotPasswordSchema.safeParse(body);
      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      await requestPasswordReset(
        parsed.data.organizationCode,
        parsed.data.accountType,
        parsed.data.email,
      );

      return {
        requested: true,
      };
    },
  });

  /*
   * POST /api/auth/reset-password
   */
  route({
    method: 'POST',
    path: '/api/auth/reset-password',
    public: true,
    status: 200,
    handler: async ({ body }) => {
      const parsed = resetPasswordSchema.safeParse(body);
      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      await resetPasswordWithToken(parsed.data.token, parsed.data.newPassword);

      return {
        reset: true,
      };
    },
  });

  /* =========================================================================
   * Authenticated User Endpoints (authOnly: true)
   * ========================================================================= */

  /*
   * GET /api/auth/me
   */
  route({
    method: 'GET',
    path: '/api/auth/me',
    authOnly: true,
    status: 200,
    handler: async ({ ctx }) => {
      return {
        user: await me(ctx.organizationId, ctx.principal.id),
      };
    },
  });

  /*
   * POST /api/auth/logout
   */
  route({
    method: 'POST',
    path: '/api/auth/logout',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, req, res }) => {
      const sessionId = req.authSessionId;
      if (sessionId) {
        await logout(ctx.organizationId, sessionId);
      }

      clearAuthCookies(res);

      return {
        loggedOut: true,
      };
    },
  });

  /*
   * POST /api/auth/change-password
   */
  route({
    method: 'POST',
    path: '/api/auth/change-password',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, body }) => {
      const parsed = changePasswordSchema.safeParse(body);
      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      await changePassword(
        ctx.organizationId,
        ctx.principal.id,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );

      return {
        changed: true,
      };
    },
  });

  /*
   * GET /api/auth/sessions
   */
  route({
    method: 'GET',
    path: '/api/auth/sessions',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, req }) => {
      return {
        sessions: await listUserSessions(
          ctx.organizationId,
          ctx.principal.id,
          req.authSessionId,
        ),
      };
    },
  });

  /*
   * DELETE /api/auth/sessions/:id
   */
  route({
    method: 'DELETE',
    path: '/api/auth/sessions/:id',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, params }) => {
      const sessionId = params['id'];
      if (!sessionId) {
        throw new Error('Session ID is required');
      }

      await revokeSingleSession(ctx.organizationId, ctx.principal.id, sessionId);

      return {
        revoked: true,
      };
    },
  });

  /*
   * DELETE /api/auth/sessions (revoke other sessions)
   */
  route({
    method: 'DELETE',
    path: '/api/auth/sessions',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, req }) => {
      const sessionId = req.authSessionId;
      if (!sessionId) {
        throw new Error('Current session ID is required');
      }

      await revokeOtherSessions(ctx.organizationId, ctx.principal.id, sessionId);

      return {
        revokedOther: true,
      };
    },
  });

  /*
   * GET /api/auth/mfa/status
   */
  route({
    method: 'GET',
    path: '/api/auth/mfa/status',
    authOnly: true,
    status: 200,
    handler: async ({ ctx }) => {
      return {
        enrollments: await listUserMfaEnrollments(ctx.organizationId, ctx.principal.id),
      };
    },
  });

  /*
   * POST /api/auth/mfa/enroll
   */
  route({
    method: 'POST',
    path: '/api/auth/mfa/enroll',
    authOnly: true,
    status: 200,
    handler: async ({ ctx }) => {
      const user = await me(ctx.organizationId, ctx.principal.id);
      const enrollment = await startTotpEnrollment(
        ctx.organizationId,
        ctx.principal.id,
        user.email ?? 'user@tapcrm',
      );

      return enrollment;
    },
  });

  /*
   * POST /api/auth/mfa/confirm
   */
  route({
    method: 'POST',
    path: '/api/auth/mfa/confirm',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, body }) => {
      const parsed = mfaConfirmSchema.safeParse(body);
      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      await confirmTotpEnrollment(
        ctx.organizationId,
        ctx.principal.id,
        parsed.data.secret,
        parsed.data.code,
        parsed.data.recoveryCodes,
        parsed.data.label,
      );

      return {
        confirmed: true,
      };
    },
  });

  /*
   * DELETE /api/auth/mfa/enrollment/:id
   */
  route({
    method: 'DELETE',
    path: '/api/auth/mfa/enrollment/:id',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, params }) => {
      const enrollmentId = params['id'];
      if (!enrollmentId) {
        throw new Error('Enrollment ID is required');
      }

      await revokeMfaEnrollment(ctx.organizationId, ctx.principal.id, enrollmentId);

      return {
        revoked: true,
      };
    },
  });

  /*
   * GET /api/auth/geofence/status (ID-15b)
   */
  route({
    method: 'GET',
    path: '/api/auth/geofence/status',
    authOnly: true,
    status: 200,
    handler: async ({ ctx }) => {
      return {
        geofence: await getUserGeofenceStatus(ctx.organizationId, ctx.principal.id),
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/auth/mfa/passkey/options',
    public: true,
    status: 200,
    handler: async ({ body }) => {
      const parsed = mfaPasskeyOptionsSchema.safeParse(body);
      if (!parsed.success) throw new RequestValidationError(parsed.error.issues);
      const challenge = await verifyMfaChallengeToken(parsed.data.mfaToken);
      if (!challenge) throw new Error('Invalid MFA challenge.');
      return startPasskeyAuthentication(challenge.org, challenge.sub);
    },
  });
  /* Passkeys — ID-5/ID-5d */
  route({
    method: 'POST',
    path: '/api/auth/passkeys/register/options',
    authOnly: true,
    status: 200,
    handler: async ({ ctx }) => {
      const u = await me(ctx.organizationId, ctx.principal.id);
      return startPasskeyRegistration(
        ctx.organizationId,
        ctx.principal.id,
        u.email ?? '',
        u.fullName,
      );
    },
  });
  route({
    method: 'POST',
    path: '/api/auth/passkeys/register/verify',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, body }) => ({
      result: await finishPasskeyRegistration(
        ctx.organizationId,
        ctx.principal.id,
        body as Parameters<typeof finishPasskeyRegistration>[2],
      ),
    }),
  });
  route({
    method: 'GET',
    path: '/api/auth/passkeys',
    authOnly: true,
    status: 200,
    handler: async ({ ctx }) => ({
      passkeys: await listUserPasskeys(ctx.organizationId, ctx.principal.id),
    }),
  });
  route({
    method: 'DELETE',
    path: '/api/auth/passkeys/:id',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, params }) => {
      await revokePasskey(ctx.organizationId, ctx.principal.id, params['id']!);
      return { revoked: true };
    },
  });

  route({
    method: 'POST',
    path: '/api/identity/wfh',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, body }) => {
      if (ctx.principal.accountType !== 'super-admin')
        throw new Error('Only Super Admin may approve WFH days.');
      const p = wfhApprovalSchema.safeParse(body);
      if (!p.success) throw new RequestValidationError(p.error.issues);
      await approveWfhDay(
        ctx.organizationId,
        p.data.userId,
        ctx.principal.id,
        p.data.workDate,
        p.data.reason,
      );
      return { approved: true };
    },
  });
  route({
    method: 'DELETE',
    path: '/api/identity/wfh',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, body }) => {
      if (ctx.principal.accountType !== 'super-admin')
        throw new Error('Only Super Admin may revoke WFH days.');
      const p = wfhRevokeSchema.safeParse(body);
      if (!p.success) throw new RequestValidationError(p.error.issues);
      await revokeWfhDay(ctx.organizationId, p.data.userId, p.data.workDate);
      return { revoked: true };
    },
  });

  route({
    method: 'POST',
    path: '/api/auth/service-accounts/:id/rotate',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, params }) => {
      if (ctx.principal.accountType !== 'super-admin')
        throw new Error('Only Super Admin may rotate service credentials.');
      return rotateServiceAccountCredential(ctx.organizationId, params['id']!);
    },
  });
  route({
    method: 'POST',
    path: '/api/auth/service-accounts/:id/disable',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, params }) => {
      if (ctx.principal.accountType !== 'super-admin')
        throw new Error('Only Super Admin may disable service accounts.');
      await disableServiceAccount(ctx.organizationId, params['id']!);
      return { disabled: true };
    },
  });

  /* Geofence appeal — ID-15d */
  route({
    method: 'POST',
    path: '/api/auth/geofence/bypass-requests',
    authOnly: true,
    status: 201,
    handler: async ({ ctx, body }) => {
      const parsed = geofenceBypassRequestSchema.safeParse(body);
      if (!parsed.success) throw new RequestValidationError(parsed.error.issues);
      return requestGeofenceBypass(ctx.organizationId, ctx.principal.id, parsed.data);
    },
  });
  route({
    method: 'GET',
    path: '/api/auth/geofence/bypass-requests',
    authOnly: true,
    status: 200,
    handler: async ({ ctx }) => ({
      requests: await listGeofenceBypassRequests(ctx.organizationId, ctx.principal.id),
    }),
  });
  route({
    method: 'POST',
    path: '/api/identity/geofence/bypass-requests/:id/decision',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, params, body }) => {
      if (ctx.principal.accountType !== 'super-admin')
        throw new Error('Only Super Admin may decide geofence bypass requests.');
      const b = body as { approve?: boolean; reason?: string };
      if (typeof b.approve !== 'boolean' || !b.reason)
        throw new Error('Decision and reason are required.');
      return decideGeofenceBypass(
        ctx.organizationId,
        params['id']!,
        ctx.principal.id,
        b.approve,
        b.reason,
      );
    },
  });

  /* Service accounts — ID-20. Credential is returned once only. */
  route({
    method: 'POST',
    path: '/api/auth/service-accounts',
    authOnly: true,
    status: 201,
    handler: async ({ ctx, body }) => {
      if (ctx.principal.accountType !== 'super-admin')
        throw new Error('Only Super Admin may create service accounts.');
      const parsed = serviceAccountCreateSchema.safeParse(body);
      if (!parsed.success) throw new RequestValidationError(parsed.error.issues);
      return createServiceAccount(ctx.organizationId, ctx.principal.id, parsed.data);
    },
  });

  /* =========================================================================
   * Protected Business Authorization Endpoints (AUTHORIZATION.md §6.4, §6.5)
   * ========================================================================= */

  /*
   * GET /api/identity/geofences
   */
  route({
    method: 'GET',
    path: '/api/identity/geofences',
    action: 'identity:manage-geofence',
    status: 200,
    handler: async ({ ctx }) => {
      return {
        locations: await listGeofenceLocations(ctx.organizationId),
      };
    },
  });

  /*
   * POST /api/identity/geofences
   */
  route({
    method: 'POST',
    path: '/api/identity/geofences',
    action: 'identity:manage-geofence',
    status: 201,
    handler: async ({ ctx, body }) => {
      const parsed = createGeofenceSchema.safeParse(body);
      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      const location = await createGeofenceLocation(ctx.organizationId, parsed.data);

      return {
        location,
      };
    },
  });

  /*
   * PATCH /api/identity/geofences/:id
   */
  route({
    method: 'PATCH',
    path: '/api/identity/geofences/:id',
    action: 'identity:manage-geofence',
    status: 200,
    handler: async ({ ctx, params, body }) => {
      const locationId = params['id'];
      if (!locationId) {
        throw new Error('Location ID is required');
      }

      const parsed = updateGeofenceSchema.safeParse(body);
      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      const location = await updateGeofenceLocation(
        ctx.organizationId,
        locationId,
        parsed.data,
      );

      return {
        location,
      };
    },
  });

  /*
   * POST /api/identity/geofences/:id/assign
   */
  route({
    method: 'POST',
    path: '/api/identity/geofences/:id/assign',
    action: 'identity:manage-geofence',
    status: 200,
    handler: async ({ ctx, params, body }) => {
      const locationId = params['id'];
      if (!locationId) {
        throw new Error('Location ID is required');
      }

      const parsed = assignGeofenceSchema.safeParse(body);
      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      await assignGeofenceLocation(
        ctx.organizationId,
        locationId,
        parsed.data.userId,
        parsed.data.bypassUntil ?? undefined,
        parsed.data.bypassReason ?? undefined,
      );

      return {
        assigned: true,
      };
    },
  });

  /*
   * POST /api/identity/users/:id/unlock
   */
  route({
    method: 'POST',
    path: '/api/identity/users/:id/unlock',
    action: 'identity:unlock-account',
    status: 200,
    handler: async ({ ctx, params }) => {
      const userId = params['id'];
      if (!userId) {
        throw new Error('User ID is required');
      }

      await unlockUserAccount(ctx.organizationId, userId);

      return {
        unlocked: true,
      };
    },
  });
}
