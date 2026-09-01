import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { sendEmailVerification } from './email.js';
import argon2 from 'argon2';
import { loadConfig } from '../../config.js';
import {
  bootstrapDb,
  db,
  identityDb,
  platformDb,
  type Tx,
} from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  InvalidCredentialsError,
  InvalidSessionError,
  MfaRequiredError,
} from '../../platform/http/auth-error.js';

import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
  type AccessTokenPayload,
} from './token.js';

import { verifyPassword } from './password.js';
import {
  checkLoginSecurity,
  recordLoginFailure,
  recordLoginSuccess,
  evaluateSuspiciousLogin,
  sendRefreshReuseAlert,
} from './security.js';
import {
  checkMfaRequirement,
  verifyMfaFactor,
  triggerEmailOtp,
  listUserMfaEnrollments,
} from './mfa.js';
import { evaluateGeofence } from './geofence.js';
import type { LoginInput, MfaChallengeInput, SignupInput } from './validation.js';

export interface RequestMeta {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly countryCode?: string | null;
}

export interface AuthUser {
  readonly id: string;
  readonly organizationId: string;
  readonly accountType: 'super-admin' | 'employee' | 'client' | 'service';
  readonly email: string | null;
  readonly fullName: string;
}

interface LoginUserRow {
  id: string;
  organizationId: string;
  accountType: 'super-admin' | 'employee' | 'client' | 'service';
  email: string | null;
  passwordHash: string | null;
  status: 'active' | 'inactive' | 'locked' | 'offboarded';
  fullName: string;
  sessionVersion: number;
  positionId: string | null;
  mfaRequired: boolean;
  emailVerifiedAt: Date | null;
  employmentStatus: string | null;
}

interface OrganizationRow {
  id: string;
  code: string;
}

interface SessionRow {
  id: string;
}

export type LoginResult =
  | {
      mfaRequired: false;
      user: AuthUser;
      accessToken: string;
      refreshToken: string;
      sessionId: string;
    }
  | {
      mfaRequired: true;
      mfaToken: string;
      requiresHighAssurance: boolean;
      availableMethods: readonly string[];
    };

interface SignupUserRow {
  id: string;
  organizationId: string;
  accountType: 'super-admin' | 'employee' | 'client';
  email: string;
  fullName: string;
}

export interface SignupResult {
  readonly user: SignupUserRow;
  readonly verificationRequired: true;
}

function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Finds the organization before a RequestContext exists.
 */
async function resolveOrganization(
  organizationCode: string,
): Promise<OrganizationRow | null> {
  const rows = await platformDb.query<OrganizationRow>(
    'organization-provisioning',
    'resolve organization for authentication',
    sql`
      SELECT id, code
      FROM organization
      WHERE lower(code) = lower(${organizationCode.trim()})
        AND status = 'active'
      LIMIT 1
    `,
  );

  return rows[0] ?? null;
}

/**
 * Loads the user using the claimed organization as tenant context.
 */
async function findLoginUser(
  organizationId: string,
  input: LoginInput,
): Promise<LoginUserRow | null> {
  const rows = await bootstrapDb.readAs<LoginUserRow>(
    organizationId,
    sql`
      SELECT
        u.id,
        u.organization_id AS "organizationId",
        account_type AS "accountType",
        email,
        password_hash AS "passwordHash",
        status,
        full_name AS "fullName",
        session_version AS "sessionVersion",
        position_id AS "positionId",
        mfa_required AS "mfaRequired",
        email_verified_at AS "emailVerifiedAt",
        ep.employment_status AS "employmentStatus"
      FROM app_user u
      LEFT JOIN employee_profile ep
        ON ep.organization_id = u.organization_id
       AND ep.user_id = u.id
      WHERE u.organization_id = ${organizationId}
        AND u.account_type = ${input.accountType}
        AND u.email = ${input.email}
      LIMIT 1
    `,
  );

  return rows[0] ?? null;
}

/**
 * Creates a session and rotating refresh-token family.
 */
async function createSessionAndRefreshToken(
  tx: Tx,
  user: AuthUser & { sessionVersion: number },
  meta: RequestMeta,
): Promise<{
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}> {
  const config = loadConfig();
  const generated = generateRefreshToken(user.organizationId);
  const familyId = randomUUID();

  const session = await tx.one<SessionRow>(sql`
    INSERT INTO session (
      organization_id,
      user_id,
      session_version,
      ip,
      user_agent,
      expires_at
    )
    VALUES (
      ${user.organizationId},
      ${user.id},
      ${user.sessionVersion},
      ${meta.ip},
      ${meta.userAgent},
      NOW() + (
        ${config.REFRESH_TOKEN_TTL_SECONDS}
        * INTERVAL '1 second'
      )
    )
    RETURNING id
  `);

  await tx.one(sql`
    INSERT INTO refresh_token (
      organization_id,
      session_id,
      token_hash,
      family_id,
      expires_at
    )
    VALUES (
      ${user.organizationId},
      ${session.id},
      ${generated.hash},
      ${familyId},
      NOW() + (
        ${config.REFRESH_TOKEN_TTL_SECONDS}
        * INTERVAL '1 second'
      )
    )
    RETURNING id
  `);

  const accessToken = await signAccessToken({
    sub: user.id,
    org: user.organizationId,
    typ: user.accountType,
    ver: user.sessionVersion,
    sid: session.id,
  });

  return {
    accessToken,
    refreshToken: generated.raw,
    sessionId: session.id,
  };
}

export async function signup(input: SignupInput): Promise<SignupResult> {
  const tokenHash = hashVerificationToken(input.invitationToken);

  const invitation = await platformDb.query<{
    id: string;
    organizationId: string;
    userId: string;
    email: string;
    fullName: string;
    organizationCode: string;
  }>(
    'employee-invitation',
    'resolve employee invitation',
    sql`
      SELECT
        i.id,
        i.organization_id AS "organizationId",
        i.user_id AS "userId",
        u.email,
        u.full_name AS "fullName",
        o.code AS "organizationCode"
      FROM employee_invitation i
      INNER JOIN organization o ON o.id = i.organization_id
      INNER JOIN app_user u
        ON u.organization_id = i.organization_id
       AND u.id = i.user_id
      WHERE i.token_hash = ${tokenHash}
        AND i.accepted_at IS NULL
        AND i.expires_at > NOW()
        AND u.account_type = 'employee'
        AND u.status = 'active'
      LIMIT 1
    `,
  );

  const match = invitation[0];
  if (!match) {
    throw new InvalidSessionError();
  }

  const verificationToken = randomBytes(32).toString('base64url');
  const verificationHash = hashVerificationToken(verificationToken);

  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const user = await db.transaction(
    {
      organizationId: match.organizationId,
      principal: {
        id: match.userId,
        organizationId: match.organizationId,
        accountType: 'employee',
        sessionVersion: 1,
        positionId: '',
        departmentId: '',
        teamId: null,
        reportsTo: null,
        organizationalLevel: 1,
      } as Parameters<typeof db.transaction>[0]['principal'],
      requestId: `auth:signup:${randomUUID()}`,
      memo: new Map(),
      sourceIp: null,
    },
    async (tx) => {
      const created = await tx.one<SignupUserRow>(sql`
        UPDATE app_user
        SET
          full_name = ${input.fullName},
          password_hash = ${passwordHash},
          email_verified_at = NULL,
          updated_at = NOW()
        WHERE organization_id = ${match.organizationId}
          AND id = ${match.userId}
          AND account_type = 'employee'
          AND password_hash IS NULL
        RETURNING
          id,
          organization_id AS "organizationId",
          account_type AS "accountType",
          email,
          full_name AS "fullName"
      `);

      await tx.one(sql`
        UPDATE employee_profile
        SET
          contact = ${input.contact},
          date_of_birth = ${input.dateOfBirth ?? null},
          gender = ${input.gender ?? null},
          updated_at = NOW()
        WHERE organization_id = ${match.organizationId}
          AND user_id = ${match.userId}
        RETURNING id
      `);

      await tx.one(sql`
        UPDATE employee_invitation
        SET accepted_at = NOW()
        WHERE organization_id = ${match.organizationId}
          AND id = ${match.id}
          AND accepted_at IS NULL
        RETURNING id
      `);

      await tx.one(sql`
        INSERT INTO email_verification_token (
          organization_id, user_id, token_hash, expires_at
        )
        VALUES (
          ${match.organizationId}, ${match.userId}, ${verificationHash},
          NOW() + INTERVAL '24 hours'
        )
        RETURNING id
      `);

      return created;
    },
  );

  await sendEmailVerification(user.email, verificationToken, match.organizationCode);

  return {
    user,
    verificationRequired: true,
  };
}

/**
 * Login with brute force check, geofencing, password verification, and MFA routing.
 */
export async function login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
  const organization = await resolveOrganization(input.organizationCode);
  if (organization === null) {
    throw new InvalidCredentialsError();
  }

  // ID-9: Check progressive delay & brute-force lockout
  const securityState = await checkLoginSecurity(
    organization.id,
    input.accountType,
    input.email,
    meta.ip,
  );

  if (securityState.isLocked) {
    throw new InvalidCredentialsError();
  }

  if (securityState.delayMs && securityState.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, securityState.delayMs));
  }

  const user = await findLoginUser(organization.id, input);

  if (
    user === null ||
    user.status !== 'active' ||
    user.passwordHash === null ||
    (user.accountType === 'employee' && user.employmentStatus !== 'active')
  ) {
    await recordLoginFailure(organization.id, input.accountType, input.email, meta.ip);
    throw new InvalidCredentialsError();
  }

  const passwordValid = await verifyPassword(user.passwordHash, input.password);
  if (!passwordValid) {
    await recordLoginFailure(organization.id, input.accountType, input.email, meta.ip);
    throw new InvalidCredentialsError();
  }

  // ID-13..ID-18b: Geofence evaluation
  const geofenceResult = await evaluateGeofence(
    organization.id,
    {
      id: user.id,
      accountType: user.accountType,
      email: user.email,
      fullName: user.fullName,
    },
    input.coordinates,
    meta,
  );

  if (!geofenceResult.allowed) {
    throw new Error(geofenceResult.reason ?? 'Access denied by geofencing policy');
  }

  // Reset brute-force counter upon successful credentials + geofence
  recordLoginSuccess(organization.id, input.accountType, input.email, meta.ip);

  // ID-4 & ID-5: MFA requirement check
  const mfaReq = await checkMfaRequirement(organization.id, {
    id: user.id,
    accountType: user.accountType,
    positionId: user.positionId,
    mfaRequired: user.mfaRequired,
  });

  const enrollments = await listUserMfaEnrollments(organization.id, user.id);
  const highAssuranceMethods = enrollments.filter((e) => e.assurance === 'high');
  const hasAcceptableMfa = mfaReq.requiresHighAssurance
    ? highAssuranceMethods.length > 0
    : enrollments.length > 0;

  if (mfaReq.required && !hasAcceptableMfa) {
    throw new MfaRequiredError(
      mfaReq.requiresHighAssurance
        ? 'High-assurance MFA enrollment is required for this account before sign-in.'
        : 'MFA enrollment is required for this account before sign-in.',
    );
  }

  if (mfaReq.required || enrollments.length > 0) {
    const mfaToken = await signMfaChallengeToken({
      sub: user.id,
      org: user.organizationId,
      typ: user.accountType,
      ver: user.sessionVersion,
      requiresHighAssurance: mfaReq.requiresHighAssurance,
    });

    const availableMethods = enrollments.map((e) => e.method);
    if (
      !mfaReq.requiresHighAssurance &&
      user.email &&
      !availableMethods.includes('email-otp')
    ) {
      // Auto-trigger email OTP for low-assurance accounts if configured
      void triggerEmailOtp(user.organizationId, user.id, user.email);
      availableMethods.push('email-otp');
    }

    return {
      mfaRequired: true,
      mfaToken,
      requiresHighAssurance: mfaReq.requiresHighAssurance,
      availableMethods,
    };
  }

  // ID-10: Evaluate suspicious login
  void evaluateSuspiciousLogin(organization.id, user.id, user.email, {
    ...meta,
    latitude: input.coordinates?.latitude ?? null,
    longitude: input.coordinates?.longitude ?? null,
  });

  const authUser: AuthUser & { sessionVersion: number } = {
    id: user.id,
    organizationId: user.organizationId,
    accountType: user.accountType,
    email: user.email,
    fullName: user.fullName,
    sessionVersion: user.sessionVersion,
  };

  const tokens = await db.transaction(
    {
      organizationId: user.organizationId,
      principal: {
        id: user.id,
        organizationId: user.organizationId,
        accountType: user.accountType,
        sessionVersion: user.sessionVersion,
      } as AuthUser & Parameters<typeof db.transaction>[0]['principal'],
      requestId: `auth:login:${randomUUID()}`,
      memo: new Map(),
      sourceIp: meta.ip,
    },
    async (tx) => {
      return createSessionAndRefreshToken(tx, authUser, meta);
    },
  );

  return {
    mfaRequired: false,
    user: {
      id: authUser.id,
      organizationId: authUser.organizationId,
      accountType: authUser.accountType,
      email: authUser.email,
      fullName: authUser.fullName,
    },
    ...tokens,
  };
}

/**
 * Completes MFA challenge step during login.
 */
export async function completeMfaChallenge(
  input: MfaChallengeInput,
  meta: RequestMeta,
): Promise<{
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}> {
  const challenge = await verifyMfaChallengeToken(input.mfaToken);
  if (!challenge) {
    throw new InvalidSessionError();
  }

  // ID-5a: Privileged positions must use a high-assurance factor
  if (challenge.requiresHighAssurance && input.method === 'email-otp') {
    throw new Error(
      'Email OTP does not satisfy the high-assurance MFA requirement for privileged accounts.',
    );
  }

  const verified = await verifyMfaFactor(
    challenge.org,
    challenge.sub,
    input.method,
    input.factorValue,
    meta.ip,
  );

  if (!verified.verified) {
    throw new InvalidCredentialsError();
  }

  const rows = await bootstrapDb.readAs<{
    id: string;
    organizationId: string;
    accountType: 'super-admin' | 'employee' | 'client' | 'service';
    email: string | null;
    status: string;
    fullName: string;
    sessionVersion: number;
  }>(
    challenge.org,
    sql`
      SELECT
        id,
        organization_id AS "organizationId",
        account_type AS "accountType",
        email,
        status,
        full_name AS "fullName",
        session_version AS "sessionVersion"
      FROM app_user
      WHERE organization_id = ${challenge.org}
        AND id = ${challenge.sub}
        AND status = 'active'
        AND session_version = ${challenge.ver}
      LIMIT 1
    `,
  );

  const user = rows[0];
  if (!user) {
    throw new InvalidSessionError();
  }

  void evaluateSuspiciousLogin(challenge.org, user.id, user.email, meta);

  const authUser: AuthUser & { sessionVersion: number } = {
    id: user.id,
    organizationId: user.organizationId,
    accountType: user.accountType,
    email: user.email,
    fullName: user.fullName,
    sessionVersion: user.sessionVersion,
  };

  const tokens = await db.transaction(
    {
      organizationId: user.organizationId,
      principal: {
        id: user.id,
        organizationId: user.organizationId,
        accountType: user.accountType,
        sessionVersion: user.sessionVersion,
      } as AuthUser & Parameters<typeof db.transaction>[0]['principal'],
      requestId: `auth:mfa:${randomUUID()}`,
      memo: new Map(),
      sourceIp: meta.ip,
    },
    async (tx) => {
      return createSessionAndRefreshToken(tx, authUser, meta);
    },
  );

  return {
    user: {
      id: authUser.id,
      organizationId: authUser.organizationId,
      accountType: authUser.accountType,
      email: authUser.email,
      fullName: authUser.fullName,
    },
    ...tokens,
  };
}

/**
 * Refresh token rotation with family reuse revocation (ID-6).
 */
export async function refresh(
  rawRefreshToken: string,
  meta: RequestMeta,
): Promise<{
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}> {
  if (!rawRefreshToken) {
    throw new InvalidSessionError();
  }

  const tokenHash = hashRefreshToken(rawRefreshToken);

  const matches = await platformDb.query<{
    organizationId: string;
    refreshTokenId: string;
    sessionId: string;
    userId: string;
    familyId: string;
    usedAt: string | null;
    expiresAt: string;
    sessionVersion: number;
    userSessionVersion: number;
    status: string;
    accountType: 'super-admin' | 'employee' | 'client' | 'service';
    email: string | null;
    fullName: string;
  }>(
    'health-check',
    'resolve refresh token during authentication',
    sql`
      SELECT
        rt.organization_id,
        rt.id AS refresh_token_id,
        rt.session_id,
        rt.family_id,
        rt.used_at,
        rt.expires_at,

        s.user_id,
        s.session_version,

        u.session_version AS user_session_version,
        u.status,
        u.account_type,
        u.email,
        u.full_name
      FROM refresh_token rt
      INNER JOIN session s
        ON s.id = rt.session_id
       AND s.organization_id = rt.organization_id
      INNER JOIN app_user u
        ON u.id = s.user_id
       AND u.organization_id = rt.organization_id
      WHERE rt.token_hash = ${tokenHash}
      LIMIT 1
    `,
  );

  const match = matches[0];
  if (match === undefined) {
    throw new InvalidSessionError();
  }

  if (match.usedAt !== null) {
    // ID-6: Refresh-token reuse detection revokes entire family
    await revokeRefreshFamily(match.organizationId, match.familyId);
    void sendRefreshReuseAlert(match.email, meta.ip);
    throw new InvalidSessionError();
  }

  if (new Date(match.expiresAt).getTime() <= Date.now()) {
    throw new InvalidSessionError();
  }

  if (match.status !== 'active' || match.sessionVersion !== match.userSessionVersion) {
    throw new InvalidSessionError();
  }

  const user: AuthUser & { sessionVersion: number } = {
    id: match.userId,
    organizationId: match.organizationId,
    accountType: match.accountType,
    email: match.email,
    fullName: match.fullName,
    sessionVersion: match.userSessionVersion,
  };

  const result = await db.transaction(
    {
      organizationId: user.organizationId,
      principal: {
        id: user.id,
        organizationId: user.organizationId,
        accountType: user.accountType,
        sessionVersion: user.sessionVersion,
      } as AuthUser & Parameters<typeof db.transaction>[0]['principal'],
      requestId: `auth:refresh:${randomUUID()}`,
      memo: new Map(),
      sourceIp: meta.ip,
    },
    async (tx) => {
      const consumed = await tx.maybeOne<{ id: string }>(sql`
        UPDATE refresh_token
        SET used_at = NOW()
        WHERE id = ${match.refreshTokenId}
          AND used_at IS NULL
          AND expires_at > NOW()
        RETURNING id
      `);

      if (consumed === null) {
        throw new InvalidSessionError();
      }

      return createSessionAndRefreshToken(tx, user, meta);
    },
  );

  return {
    user: {
      id: user.id,
      organizationId: user.organizationId,
      accountType: user.accountType,
      email: user.email,
      fullName: user.fullName,
    },
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  };
}

/**
 * Revokes an entire refresh-token family (ID-6).
 */
async function revokeRefreshFamily(
  organizationId: string,
  familyId: string,
): Promise<void> {
  await identityDb.transactionForOrganization(organizationId, async (tx) => {
    await tx.query(sql`
      UPDATE refresh_token
      SET used_at = COALESCE(used_at, NOW())
      WHERE organization_id = ${organizationId} AND family_id = ${familyId}
    `);
  });
}

/**
 * Logout - revokes session.
 */
export async function logout(organizationId: string, sessionId: string): Promise<void> {
  await identityDb.transactionForOrganization(organizationId, async (tx) => {
    await tx.query(sql`
      UPDATE session
      SET revoked_at = NOW()
      WHERE organization_id = ${organizationId}
        AND id = ${sessionId}
        AND revoked_at IS NULL
    `);
  });
}

/**
 * Gets the authenticated user.
 */
export async function me(organizationId: string, userId: string): Promise<AuthUser> {
  const rows = await bootstrapDb.readAs<{
    id: string;
    organizationId: string;
    accountType: 'super-admin' | 'employee' | 'client' | 'service';
    email: string | null;
    fullName: string;
    status: string;
  }>(
    organizationId,
    sql`
      SELECT
        id,
        organization_id AS "organizationId",
        account_type AS "accountType",
        email,
        full_name AS "fullName",
        status
      FROM app_user
      WHERE id = ${userId}
        AND organization_id = ${organizationId}
      LIMIT 1
    `,
  );

  const user = rows[0];
  if (user === undefined || user.status !== 'active') {
    throw new InvalidSessionError();
  }

  return user;
}

export async function verifyEmail(token: string): Promise<{ verified: true }> {
  const tokenHash = hashVerificationToken(token);

  const matches = await platformDb.query<{
    organizationId: string;
    tokenId: string;
    userId: string;
  }>(
    'email-verification',
    'verify email token',
    sql`
      SELECT
        organization_id AS "organizationId",
        id AS "tokenId",
        user_id AS "userId"
      FROM email_verification_token
      WHERE token_hash = ${tokenHash}
        AND verified_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
    `,
  );

  const match = matches[0];
  if (!match) throw new Error('Verification link is invalid or has expired');

  await identityDb.transactionForOrganization(match.organizationId, async (tx) => {
    const consumed = await tx.maybeOne<{ id: string }>(sql`
      UPDATE email_verification_token
      SET verified_at = NOW()
      WHERE id = ${match.tokenId}
        AND organization_id = ${match.organizationId}
        AND verified_at IS NULL
        AND expires_at > NOW()
      RETURNING id
    `);
    if (!consumed) throw new Error('Verification link is invalid or has expired');

    await tx.query(sql`
      UPDATE app_user
      SET email_verified_at = NOW(), updated_at = NOW()
      WHERE id = ${match.userId}
        AND organization_id = ${match.organizationId}
        AND email_verified_at IS NULL
    `);
  });

  return { verified: true };
}

/* ========================================================================
 * ID-20 — Service-account credentials
 * ======================================================================== */
import Redis from 'ioredis';
import { REGISTRY, type Action } from '@tapcrm/contracts';

function serviceCredentialHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function serviceRedis() {
  return new Redis(loadConfig().REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
}

export interface ServiceAccountCreateInput {
  name: string;
  description?: string;
  allowedActions: string[];
  allowedResources: string[];
  recordFilter?: Record<string, unknown>;
  ipAllowlist?: string[];
  expiresAt: string;
  rateLimitMinute: number;
  rateLimitDay: number;
}
export async function createServiceAccount(
  organizationId: string,
  createdBy: string,
  input: ServiceAccountCreateInput,
) {
  const expires = new Date(input.expiresAt);
  const max = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(expires.getTime()) || expires <= new Date() || expires > max)
    throw new Error(
      'Service-account expiry must be in the future and no more than 365 days.',
    );
  const actions = input.allowedActions.filter((a) =>
    Object.prototype.hasOwnProperty.call(REGISTRY, a),
  );
  if (actions.length !== input.allowedActions.length)
    throw new Error('One or more service-account actions are not registered.');
  const secret = `tcrm_sa_${organizationId}_${randomBytes(32).toString('base64url')}`;
  const prefix = secret.slice(0, 16);
  const last4 = secret.slice(-4);
  const hash = serviceCredentialHash(secret);
  const row = await identityDb.transactionForOrganization(organizationId, (tx) =>
    tx.one<{ id: string }>(
      sql`INSERT INTO service_account(organization_id,name,description,allowed_actions,allowed_resources,record_filter,ip_allowlist,expires_at,rate_limit_minute,rate_limit_day,credential_hash,credential_prefix,credential_last4,created_by) VALUES(${organizationId},${input.name},${input.description ?? null},${actions},${input.allowedResources},${input.recordFilter ? JSON.stringify(input.recordFilter) : null}::jsonb,${input.ipAllowlist ?? null},${expires.toISOString()},${input.rateLimitMinute},${input.rateLimitDay},${hash},${prefix},${last4},${createdBy}) RETURNING id`,
    ),
  );
  return { id: row.id, credential: secret, expiresAt: expires.toISOString() };
}
export async function authenticateServiceCredential(
  credential: string,
  ip: string | null,
) {
  if (!credential.startsWith('tcrm_sa_')) return null;
  const hash = serviceCredentialHash(credential);
  const parts = credential.split('_');
  const organizationId = parts[2];
  if (!organizationId) return null;
  const rows = await bootstrapDb.readAs<{
    id: string;
    organizationId: string;
    allowedActions: string[];
    allowedResources: string[];
    expiresAt: string;
    ipAllowlist: string[] | null;
    rateLimitMinute: number;
    rateLimitDay: number;
    disabledAt: string | null;
  }>(
    organizationId,
    sql`SELECT id,organization_id AS "organizationId",allowed_actions AS "allowedActions",allowed_resources AS "allowedResources",expires_at AS "expiresAt",ip_allowlist AS "ipAllowlist",rate_limit_minute AS "rateLimitMinute",rate_limit_day AS "rateLimitDay",disabled_at AS "disabledAt" FROM service_account WHERE organization_id=${organizationId} AND credential_hash=${hash} LIMIT 1`,
  );
  const sa = rows[0];
  if (!sa || sa.disabledAt || new Date(sa.expiresAt) <= new Date()) return null;
  if (sa.ipAllowlist?.length && ip && !sa.ipAllowlist.includes(ip)) return null;
  if (sa.ipAllowlist?.length && !ip) return null;
  const r = serviceRedis();
  const minuteKey = `tapcrm:sa:${sa.id}:m:${Math.floor(Date.now() / 60000)}`;
  const dayKey = `tapcrm:sa:${sa.id}:d:${new Date().toISOString().slice(0, 10)}`;
  const m = await r.incr(minuteKey);
  if (m === 1) await r.expire(minuteKey, 120);
  const day = await r.incr(dayKey);
  if (day === 1) await r.expire(dayKey, 172800);
  if (m > sa.rateLimitMinute || day > sa.rateLimitDay) return null;
  await platformDb.query(
    'health-check',
    'touch service account usage',
    sql`UPDATE service_account SET last_used_at=NOW() WHERE organization_id=${sa.organizationId} AND id=${sa.id}`,
  );
  return sa;
}
export async function rotateServiceAccountCredential(
  organizationId: string,
  serviceAccountId: string,
) {
  const secret = `tcrm_sa_${organizationId}_${randomBytes(32).toString('base64url')}`;
  const hash = serviceCredentialHash(secret);
  await identityDb.transactionForOrganization(organizationId, (tx) =>
    tx.query(
      sql`UPDATE service_account SET credential_hash=${hash},credential_prefix=${secret.slice(0, 16)},credential_last4=${secret.slice(-4)},last_used_at=NULL WHERE organization_id=${organizationId} AND id=${serviceAccountId} AND disabled_at IS NULL`,
    ),
  );
  return { credential: secret };
}
export async function disableServiceAccount(
  organizationId: string,
  serviceAccountId: string,
) {
  await identityDb.transactionForOrganization(organizationId, (tx) =>
    tx.query(
      sql`UPDATE service_account SET disabled_at=NOW() WHERE organization_id=${organizationId} AND id=${serviceAccountId}`,
    ),
  );
}
