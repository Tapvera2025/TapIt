import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { loadConfig } from '../../config.js';
import { db, identityDb, platformDb, type Tx } from '../../platform/dal/db.js';
import { createAuthContext } from '../../platform/dal/context.js';
import { sql } from '../../platform/dal/sql.js';
import {
  AccountLockedError,
  AssuranceTooLowError,
  GeofenceDeniedError,
  InvalidCredentialsError,
  InvalidSessionError,
  MfaEnrolmentRequiredError,
  TooManyAttemptsError,
} from '../../platform/http/auth-error.js';

import {
  hashToken,
  mintScopedToken,
  parseScopedToken,
  signAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
} from './token.js';

import { verifyPassword } from './password.js';
import {
  checkLoginSecurity,
  recordLoginFailure,
  recordLoginSuccess,
  evaluateSuspiciousLogin,
} from './security.js';
import { checkMfaRequirement, verifyMfaFactor, listUserMfaEnrollments } from './mfa.js';
import { evaluateGeofence } from './geofence.js';
import { revokeAllUserSessions, revokeSession } from './sessions.js';
import { sendRefreshReuseAlert } from './email.js';
import type { LoginInput, MfaChallengeInput, SignupInput } from './validation.js';

/**
 * Authentication — PRD §8.1 `identity`.
 *
 * Three properties this module has to hold, each with a specific shape in the
 * code below:
 *
 *   ID-4  A privileged account cannot obtain a session with a password alone.
 *         Enforced by branching on whether MFA is REQUIRED, not on whether the
 *         user happens to have enrolled — an account that needs a factor and
 *         does not have one is refused a session and sent to enrol.
 *
 *   ID-6  A replayed refresh token kills its whole family. Enforced by rotating
 *         WITHIN one session with a stable `family_id`, so the chain from the
 *         original sign-in to the current token is walkable. Minting a new
 *         family on every rotation makes every family one link long and the
 *         control unreachable.
 *
 *   ID-7  Revocation is immediate. Enforced twice over: the session row is
 *         revoked, which stops refresh; and `session_version` is incremented,
 *         which stops access tokens already in flight, because the resolver
 *         compares that claim on every request.
 *
 * Everything here reaches the database through `identityDb`, which sets tenant
 * context from the organization carried on the presented credential. There is
 * no path in this file that touches a tenant table without one.
 */

export interface RequestMeta {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface AuthUser {
  readonly id: string;
  readonly organizationId: string;
  readonly accountType: 'super-admin' | 'employee' | 'client' | 'service';
  readonly email: string | null;
  readonly fullName: string;
}

interface AuthenticatedUser extends AuthUser {
  readonly sessionVersion: number;
}

export type LoginResult =
  | {
      readonly mfaRequired: false;
      readonly user: AuthUser;
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly sessionId: string;
    }
  | {
      readonly mfaRequired: true;
      readonly mfaToken: string;
      readonly requiresHighAssurance: boolean;
      readonly availableMethods: readonly string[];
    };

export type IssuedSession = Extract<LoginResult, { mfaRequired: false }>;

export interface SignupResult {
  readonly user: {
    readonly id: string;
    readonly organizationId: string;
    readonly accountType: 'employee';
    readonly email: string;
    readonly fullName: string;
  };
}

/* ==================================================================== *
 * Lookups
 * ==================================================================== */

/**
 * `organization` is the tenant root: a row cannot gate itself, so it carries no
 * `organization_id` and no RLS policy. It is the one table that has to be
 * readable before a tenant is known, which is exactly why it is on the global
 * allow-list and nothing else is.
 */
async function resolveOrganization(
  organizationCode: string,
): Promise<{ id: string; code: string } | null> {
  const rows = await platformDb.query<{ id: string; code: string }>(
    {
      operation: 'organization-lookup',
      reason: 'resolve the organization code presented at sign-in',
      tables: ['organization'],
    },
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

interface LoginCandidate {
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

async function findLoginUser(
  organizationId: string,
  input: LoginInput,
): Promise<LoginCandidate | null> {
  return identityDb.readOne<LoginCandidate>(
    organizationId,
    sql`
      SELECT
        u.id,
        u.organization_id,
        u.account_type,
        u.email,
        u.password_hash,
        u.status,
        u.full_name,
        u.session_version,
        u.position_id,
        u.mfa_required,
        u.email_verified_at,
        ep.employment_status
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
}

/* ==================================================================== *
 * Session and token issuance
 * ==================================================================== */

/**
 * Opens a new session and the first refresh token of a new family.
 *
 * A "family" is the chain of refresh tokens descending from one sign-in. Every
 * rotation keeps the same `family_id` and points `parent_id` at the token it
 * replaced, so a replayed token can be traced to every sibling and descendant
 * in a single indexed statement. That chain is the whole mechanism behind ID-6:
 * without it, reuse detection can only kill the one token presented, which is
 * the one the attacker has already spent.
 */
async function openSession(
  tx: Tx,
  user: AuthenticatedUser,
  meta: RequestMeta,
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const config = loadConfig();

  const session = await tx.one<{ id: string; expiresAt: Date }>(sql`
    INSERT INTO session (organization_id, user_id, session_version, ip, user_agent, expires_at)
    VALUES (
      ${user.organizationId},
      ${user.id},
      ${user.sessionVersion},
      ${meta.ip},
      ${meta.userAgent},
      now() + (${config.REFRESH_TOKEN_TTL_SECONDS} * INTERVAL '1 second')
    )
    RETURNING id, expires_at
  `);

  const refreshToken = await issueRefreshToken(tx, {
    organizationId: user.organizationId,
    sessionId: session.id,
    familyId: randomUUID(),
    parentId: null,
    expiresAt: session.expiresAt,
  });

  const accessToken = await signAccessToken({
    sub: user.id,
    org: user.organizationId,
    typ: user.accountType,
    ver: user.sessionVersion,
    sid: session.id,
  });

  return { accessToken, refreshToken, sessionId: session.id };
}

async function issueRefreshToken(
  tx: Tx,
  input: {
    organizationId: string;
    sessionId: string;
    familyId: string;
    parentId: string | null;
    /** Never outlives the session it belongs to. */
    expiresAt: Date;
  },
): Promise<string> {
  const token = mintScopedToken(input.organizationId);

  await tx.one(sql`
    INSERT INTO refresh_token (
      organization_id, session_id, token_hash, family_id, parent_id, expires_at
    )
    VALUES (
      ${input.organizationId},
      ${input.sessionId},
      ${token.hash},
      ${input.familyId},
      ${input.parentId},
      ${input.expiresAt}
    )
    RETURNING id
  `);

  return token.raw;
}

/* ==================================================================== *
 * Sign-up by invitation
 * ==================================================================== */

/**
 * ED-4 / SD-7 — "A user without a position CANNOT be created. The loader has no
 * bypass." So there is no self-service registration here: the account already
 * exists, created by someone holding `users:manage`, and this endpoint only
 * sets its password and personal details from a single-use invitation.
 *
 * The invitation token carries its organization, so the flow is tenant-scoped
 * from the first statement.
 */
export async function signup(input: SignupInput): Promise<SignupResult> {
  const scope = parseScopedToken(input.invitationToken);
  if (scope === null) throw new InvalidSessionError('That invitation link is not valid.');

  const tokenHash = hashToken(input.invitationToken);

  const invitation = await identityDb.readOne<{
    id: string;
    organizationId: string;
    userId: string;
    email: string;
    fullName: string;
  }>(
    scope.organizationId,
    sql`
      SELECT i.id, i.organization_id, i.user_id, u.email, u.full_name
      FROM employee_invitation i
      INNER JOIN app_user u
        ON u.organization_id = i.organization_id
       AND u.id = i.user_id
      WHERE i.organization_id = ${scope.organizationId}
        AND i.token_hash = ${tokenHash}
        AND i.accepted_at IS NULL
        AND i.expires_at > now()
        AND u.account_type = 'employee'
        AND u.status = 'active'
      LIMIT 1
    `,
  );

  if (invitation === null) {
    throw new InvalidSessionError('That invitation link has expired or has already been used.');
  }

  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const user = await identityDb.transaction(invitation.organizationId, async (tx) => {
    // Consume the invitation first, and require it to be unconsumed. Two clicks
    // on the same link means exactly one of them sets a password.
    await tx.mustExecute(
      sql`
        UPDATE employee_invitation
        SET accepted_at = now()
        WHERE organization_id = ${invitation.organizationId}
          AND id = ${invitation.id}
          AND accepted_at IS NULL
      `,
      'employee invitation',
    );

    const created = await tx.one<{
      id: string;
      organizationId: string;
      accountType: 'employee';
      email: string;
      fullName: string;
    }>(sql`
      UPDATE app_user
      SET full_name = ${input.fullName},
          password_hash = ${passwordHash},
          email_verified_at = now(),
          updated_at = now()
      WHERE organization_id = ${invitation.organizationId}
        AND id = ${invitation.userId}
        AND account_type = 'employee'
        AND password_hash IS NULL
      RETURNING id, organization_id, account_type, email, full_name
    `);

    await tx.mustExecute(
      sql`
        UPDATE employee_profile
        SET contact = ${input.contact},
            date_of_birth = ${input.dateOfBirth ?? null},
            gender = ${input.gender ?? null},
            updated_at = now()
        WHERE organization_id = ${invitation.organizationId}
          AND user_id = ${invitation.userId}
      `,
      `employee profile for user ${invitation.userId}`,
    );

    return created;
  });

  return { user };
}

/* ==================================================================== *
 * Sign in
 * ==================================================================== */

export async function login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
  const organization = await resolveOrganization(input.organizationCode);
  if (organization === null) throw new InvalidCredentialsError();

  // ID-9 — checked before the password is verified, so a barred account costs
  // an Argon2 verification of nothing.
  const security = await checkLoginSecurity(
    organization.id,
    input.accountType,
    input.email,
    meta.ip,
  );
  if (security.isLocked) throw new AccountLockedError(security.retryAfterSeconds);
  if (security.retryAfterSeconds > 0) {
    // The progressive delay is returned, not slept through. Holding a worker
    // for the duration is an amplifier rather than a defence: the attacker pays
    // nothing and the server pays a request slot.
    throw new TooManyAttemptsError(security.retryAfterSeconds);
  }

  const user = await findLoginUser(organization.id, input);

  const usable =
    user !== null &&
    user.status === 'active' &&
    user.passwordHash !== null &&
    (user.accountType !== 'employee' || user.employmentStatus === 'active');

  // ID-12 — "An unverified account CAN sign in but cannot receive password
  // resets." Verification gates recovery, not access, so it is deliberately not
  // part of the test above.

  if (!usable) {
    await recordLoginFailure(organization.id, input.accountType, input.email, meta.ip);
    throw new InvalidCredentialsError();
  }

  const passwordValid = await verifyPassword(user.passwordHash ?? '', input.password);
  if (!passwordValid) {
    await recordLoginFailure(organization.id, input.accountType, input.email, meta.ip);
    throw new InvalidCredentialsError();
  }

  // ID-13 to ID-18b — location is a friction control, evaluated after the
  // password so that a denial cannot be used to probe for valid accounts.
  const geofence = await evaluateGeofence(
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
  if (!geofence.allowed) {
    throw new GeofenceDeniedError(
      geofence.reason ??
        'This sign-in was refused because it is outside your assigned locations. ' +
          'You can request a one-time exception from an administrator.',
    );
  }

  await recordLoginSuccess(organization.id, input.accountType, input.email, meta.ip);

  /* ── ID-4 / ID-5a — the second factor ──────────────────────────────
   *
   * The requirement decides, not the enrolment. Reading it the other way round
   * — challenging only when a factor happens to exist — means a privileged
   * account that never enrolled signs in on a password, which is precisely what
   * ID-4 exists to prevent.
   */
  const requirement = await checkMfaRequirement(organization.id, {
    id: user.id,
    accountType: user.accountType,
    positionId: user.positionId,
    mfaRequired: user.mfaRequired,
  });

  const enrolments = await listUserMfaEnrollments(organization.id, user.id);
  const acceptable = requirement.requiresHighAssurance
    ? enrolments.filter((enrolment) => enrolment.assurance === 'high')
    : enrolments;

  if (acceptable.length > 0) {
    const mfaToken = await signMfaChallengeToken({
      sub: user.id,
      org: user.organizationId,
      typ: user.accountType,
      ver: user.sessionVersion,
      requiresHighAssurance: requirement.requiresHighAssurance,
    });

    return {
      mfaRequired: true,
      mfaToken,
      requiresHighAssurance: requirement.requiresHighAssurance,
      // Only the factors that would actually satisfy this account are offered.
      // Listing email OTP to someone who cannot use it produces a dead end.
      availableMethods: acceptable.map((enrolment) => enrolment.method),
    };
  }

  if (requirement.required) {
    // No usable factor, and one is mandatory: no session is issued. The token
    // returned here authorises enrolment and nothing else.
    const enrolmentToken = await signMfaChallengeToken({
      sub: user.id,
      org: user.organizationId,
      typ: user.accountType,
      ver: user.sessionVersion,
      requiresHighAssurance: requirement.requiresHighAssurance,
    });
    throw new MfaEnrolmentRequiredError(enrolmentToken, requirement.requiresHighAssurance);
  }

  await evaluateSuspiciousLogin(organization.id, user.id, user.email, meta);

  return issueSession(
    {
      id: user.id,
      organizationId: user.organizationId,
      accountType: user.accountType,
      email: user.email,
      fullName: user.fullName,
      sessionVersion: user.sessionVersion,
    },
    meta,
  );
}

/** The shared tail of every path that ends in a session. */
async function issueSession(
  user: AuthenticatedUser,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const ctx = createAuthContext({
    organizationId: user.organizationId,
    userId: user.id,
    accountType: user.accountType,
    purpose: 'session-issue',
    sourceIp: meta.ip,
  });

  const tokens = await db.transaction(ctx, (tx) => openSession(tx, user, meta));

  return {
    mfaRequired: false,
    user: {
      id: user.id,
      organizationId: user.organizationId,
      accountType: user.accountType,
      email: user.email,
      fullName: user.fullName,
    },
    ...tokens,
  };
}

/* ==================================================================== *
 * MFA challenge
 * ==================================================================== */

export async function completeMfaChallenge(
  input: MfaChallengeInput,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const challenge = await verifyMfaChallengeToken(input.mfaToken);
  if (challenge === null) throw new InvalidSessionError('That sign-in attempt has expired.');

  // ID-5a — a low-assurance factor never satisfies a high-assurance
  // requirement, whatever the client offers.
  if (challenge.requiresHighAssurance && input.method === 'email-otp') {
    throw new AssuranceTooLowError();
  }

  const verified = await verifyMfaFactor(
    challenge.org,
    challenge.sub,
    input.method,
    input.factorValue,
    meta.ip,
  );
  if (!verified.verified) throw new InvalidCredentialsError();
  if (challenge.requiresHighAssurance && verified.assurance !== 'high') {
    throw new AssuranceTooLowError();
  }

  const user = await identityDb.readOne<AuthenticatedUser>(
    challenge.org,
    sql`
      SELECT id, organization_id, account_type, email, full_name, session_version
      FROM app_user
      WHERE organization_id = ${challenge.org}
        AND id = ${challenge.sub}
        AND status = 'active'
        AND session_version = ${challenge.ver}
      LIMIT 1
    `,
  );

  if (user === null) throw new InvalidSessionError('That sign-in attempt is no longer valid.');

  await evaluateSuspiciousLogin(challenge.org, user.id, user.email, meta);

  return issueSession(user, meta);
}

/* ==================================================================== *
 * Refresh — ID-6
 * ==================================================================== */

interface RefreshRow {
  refreshTokenId: string;
  organizationId: string;
  sessionId: string;
  familyId: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  sessionExpiresAt: Date;
  sessionRevokedAt: Date | null;
  sessionVersion: number;
  userId: string;
  userSessionVersion: number;
  status: string;
  accountType: 'super-admin' | 'employee' | 'client' | 'service';
  email: string | null;
  fullName: string;
}

/**
 * Exchanges a refresh token for a new pair, rotating within the same session.
 *
 * The session is NOT recreated. Rotating into a new session on every refresh
 * would give one sign-in a new row every hour — so "my devices" (ID-8) fills up
 * with phantom entries, revoking a session revokes something the user is no
 * longer holding, and the family chain resets each time, which quietly disables
 * ID-6.
 */
export async function refresh(
  rawRefreshToken: string,
  meta: RequestMeta,
): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const scope = parseScopedToken(rawRefreshToken);
  if (scope === null) throw new InvalidSessionError();

  const tokenHash = hashToken(rawRefreshToken);

  const match = await identityDb.readOne<RefreshRow>(
    scope.organizationId,
    sql`
      SELECT
        rt.id                AS refresh_token_id,
        rt.organization_id,
        rt.session_id,
        rt.family_id,
        rt.used_at,
        rt.revoked_at,
        rt.expires_at,
        s.expires_at         AS session_expires_at,
        s.revoked_at         AS session_revoked_at,
        s.session_version,
        s.user_id,
        u.session_version    AS user_session_version,
        u.status,
        u.account_type,
        u.email,
        u.full_name
      FROM refresh_token rt
      INNER JOIN session s
        ON s.organization_id = rt.organization_id
       AND s.id = rt.session_id
      INNER JOIN app_user u
        ON u.organization_id = s.organization_id
       AND u.id = s.user_id
      WHERE rt.organization_id = ${scope.organizationId}
        AND rt.token_hash = ${tokenHash}
      LIMIT 1
    `,
  );

  if (match === null) throw new InvalidSessionError();

  /* ── Reuse detection ───────────────────────────────────────────────
   *
   * ID-6: "Refresh-token reuse detection revokes the whole family and alerts
   * the user."
   *
   * A token that has already been spent being presented again means one of two
   * things: the legitimate client retried, or someone else has a copy. There is
   * no way to tell them apart from here, and only one of them is dangerous — so
   * the family dies either way. The legitimate user signs in again; the thief
   * gets nothing.
   */
  if (match.usedAt !== null || match.revokedAt !== null) {
    await revokeFamily(match.organizationId, match.familyId, match.sessionId, match.userId);
    if (match.email !== null) {
      await sendRefreshReuseAlert(match.email, meta.ip).catch(() => undefined);
    }
    throw new InvalidSessionError(
      'This sign-in was ended for safety because an old session token was replayed. ' +
        'Please sign in again.',
    );
  }

  const now = Date.now();
  const stillValid =
    match.sessionRevokedAt === null &&
    new Date(match.expiresAt).getTime() > now &&
    new Date(match.sessionExpiresAt).getTime() > now &&
    match.status === 'active' &&
    match.sessionVersion === match.userSessionVersion;

  if (!stillValid) throw new InvalidSessionError();

  const ctx = createAuthContext({
    organizationId: match.organizationId,
    userId: match.userId,
    accountType: match.accountType,
    purpose: 'session-refresh',
    sourceIp: meta.ip,
  });

  const refreshToken = await db.transaction(ctx, async (tx) => {
    // Spend the presented token. The `used_at IS NULL` guard is what makes two
    // concurrent refreshes of the same token resolve to one winner; the loser
    // affects no rows and is treated as reuse on its next attempt.
    await tx.mustExecute(
      sql`
        UPDATE refresh_token
        SET used_at = now()
        WHERE organization_id = ${match.organizationId}
          AND id = ${match.refreshTokenId}
          AND used_at IS NULL
          AND revoked_at IS NULL
      `,
      'refresh token',
    );

    return issueRefreshToken(tx, {
      organizationId: match.organizationId,
      sessionId: match.sessionId,
      familyId: match.familyId,
      parentId: match.refreshTokenId,
      expiresAt: match.sessionExpiresAt,
    });
  });

  const accessToken = await signAccessToken({
    sub: match.userId,
    org: match.organizationId,
    typ: match.accountType,
    ver: match.userSessionVersion,
    sid: match.sessionId,
  });

  return {
    user: {
      id: match.userId,
      organizationId: match.organizationId,
      accountType: match.accountType,
      email: match.email,
      fullName: match.fullName,
    },
    accessToken,
    refreshToken,
  };
}

/**
 * Kills every token descending from one sign-in, and the session with them.
 *
 * The session goes too: leaving it alive would let the access token already in
 * the attacker's hands keep working until it expires, which for a 60-minute
 * token is most of an hour after the theft was detected.
 */
async function revokeFamily(
  organizationId: string,
  familyId: string,
  sessionId: string,
  userId: string,
): Promise<void> {
  await identityDb.transaction(organizationId, async (tx) => {
    await tx.execute(sql`
      UPDATE refresh_token
      SET revoked_at = now(),
          revoked_reason = 'reuse-detected'
      WHERE organization_id = ${organizationId}
        AND family_id = ${familyId}
        AND revoked_at IS NULL
    `);

    await tx.execute(sql`
      UPDATE session
      SET revoked_at = now()
      WHERE organization_id = ${organizationId}
        AND id = ${sessionId}
        AND revoked_at IS NULL
    `);
  });

  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'refresh token reuse detected',
      organizationId,
      userId,
      familyId,
      sessionId,
    }),
  );
}

/* ==================================================================== *
 * Sign out and identity
 * ==================================================================== */

export async function logout(
  organizationId: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  await revokeSession(organizationId, userId, sessionId, 'logout');
}

/** ID-7 — every session a person holds, ended at once. */
export async function logoutEverywhere(
  organizationId: string,
  userId: string,
): Promise<void> {
  await revokeAllUserSessions(organizationId, userId, 'user-requested');
}

export async function me(organizationId: string, userId: string): Promise<AuthUser> {
  const user = await identityDb.readOne<AuthUser & { status: string }>(
    organizationId,
    sql`
      SELECT id, organization_id, account_type, email, full_name, status
      FROM app_user
      WHERE organization_id = ${organizationId}
        AND id = ${userId}
      LIMIT 1
    `,
  );

  if (user === null || user.status !== 'active') throw new InvalidSessionError();

  return {
    id: user.id,
    organizationId: user.organizationId,
    accountType: user.accountType,
    email: user.email,
    fullName: user.fullName,
  };
}

/* ==================================================================== *
 * Email verification — ID-12
 * ==================================================================== */

export async function verifyEmail(rawToken: string): Promise<{ verified: true }> {
  const scope = parseScopedToken(rawToken);
  if (scope === null) throw new InvalidSessionError('That verification link is not valid.');

  const tokenHash = hashToken(rawToken);

  await identityDb.transaction(scope.organizationId, async (tx) => {
    const match = await tx.maybeOne<{ id: string; userId: string }>(sql`
      UPDATE email_verification_token
      SET verified_at = now()
      WHERE organization_id = ${scope.organizationId}
        AND token_hash = ${tokenHash}
        AND verified_at IS NULL
        AND expires_at > now()
      RETURNING id, user_id
    `);

    if (match === null) {
      throw new InvalidSessionError(
        'That verification link has expired or has already been used.',
      );
    }

    await tx.mustExecute(
      sql`
        UPDATE app_user
        SET email_verified_at = now(),
            updated_at = now()
        WHERE organization_id = ${scope.organizationId}
          AND id = ${match.userId}
      `,
      `email verification for user ${match.userId}`,
    );
  });

  return { verified: true };
}
