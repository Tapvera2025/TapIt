import type { Request, Response } from 'express';
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
} from './geofence.js';

import { unlockUserAccount } from './security.js';

const ACCESS_COOKIE = 'tapcrm_access';
const REFRESH_COOKIE = 'tapcrm_refresh';

function requestMeta(req: Request) {
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? null,
    userAgent: req.get('user-agent') ?? null,
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

      if (result.mfaRequired) {
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
