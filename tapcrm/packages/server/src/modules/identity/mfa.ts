import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { bootstrapDb, identityDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  sendEmailOtp,
  sendRecoveryCodeUsedAlert,
  sendRecoveryCodeUsedAdminAlert,
} from './email.js';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';
import { loadConfig } from '../../config.js';
import Redis from 'ioredis';

export type MfaMethod = 'passkey' | 'totp' | 'email-otp';
export type MfaAssurance = 'high' | 'low';

export interface MfaEnrollmentRecord {
  readonly id: string;
  readonly method: MfaMethod;
  readonly assurance: MfaAssurance;
  readonly label: string | null;
  readonly enrolledAt: string;
  readonly lastUsedAt: string | null;
}

export interface TotpEnrollmentDetails {
  readonly secret: string;
  readonly uri: string;
  readonly recoveryCodes: readonly string[];
}

const emailOtpRedis = new Redis(loadConfig().REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
});
const emailOtpKey = (org: string, user: string) => `tapcrm:mfa:email-otp:${org}:${user}`;

// --- Base32 helper for TOTP secrets ---
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(length = 20): string {
  const bytes = randomBytes(length);
  let secret = '';
  for (let i = 0; i < bytes.length; i++) {
    secret += BASE32_ALPHABET[bytes[i]! % 32];
  }
  return secret;
}

function base32Decode(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]!);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * RFC 6238 TOTP generator.
 */
export function generateTotpCode(secret: string, timeStepWindow = 0): string {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(epoch / 30) + timeStepWindow;

  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(timeStep));

  const hmac = createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = (binary % 1_000_000).toString().padStart(6, '0');
  return otp;
}

/**
 * Verifies a TOTP code within a +/- 1 step (30s) window.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  if (!code || code.length !== 6) return false;

  for (let window = -1; window <= 1; window++) {
    const expected = generateTotpCode(secret, window);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) {
      return true;
    }
  }
  return false;
}

/**
 * Generates OTP Auth URI for QR codes.
 */
export function generateTotpUri(
  issuer: string,
  accountName: string,
  secret: string,
): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Generates 10 single-use recovery codes.
 */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(5).toString('hex').toUpperCase(); // 10 chars e.g. 4F2A1B8C9E
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

/**
 * Hashes a recovery code for secure storage.
 */
export function hashRecoveryCode(code: string): string {
  const normalized = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * ID-4 & ID-5a: Checks if an account requires MFA and if privileged positions require High assurance.
 */
export async function checkMfaRequirement(
  organizationId: string,
  user: {
    id: string;
    accountType: string;
    positionId?: string | null;
    mfaRequired?: boolean;
  },
): Promise<{ required: boolean; requiresHighAssurance: boolean }> {
  // Super admin always requires high assurance MFA (ID-4)
  if (user.accountType === 'super-admin') {
    return { required: true, requiresHighAssurance: true };
  }

  if (user.mfaRequired) {
    return { required: true, requiresHighAssurance: false };
  }

  // Check if position holds privileged policies (payroll, access-management, etc.)
  if (user.positionId) {
    const privilegedRows = await bootstrapDb.readAs<{ action: string }>(
      organizationId,
      sql`
        SELECT action
        FROM position_policy
        WHERE organization_id = ${organizationId}
          AND position_id = ${user.positionId}
          AND allowed = true
          AND (
            action LIKE 'payroll:%'
            OR action LIKE 'access:%'
            OR action LIKE 'org:%'
          )
        LIMIT 1
      `,
    );

    if (privilegedRows.length > 0) {
      return { required: true, requiresHighAssurance: true };
    }
  }

  return { required: false, requiresHighAssurance: false };
}

/**
 * Lists user active MFA enrollments.
 */
export async function listUserMfaEnrollments(
  organizationId: string,
  userId: string,
): Promise<MfaEnrollmentRecord[]> {
  const rows = await bootstrapDb.readAs<{
    id: string;
    method: MfaMethod;
    assurance: MfaAssurance;
    label: string | null;
    enrolledAt: string;
    lastUsedAt: string | null;
  }>(
    organizationId,
    sql`
      SELECT
        id,
        method,
        assurance,
        label,
        enrolled_at AS "enrolledAt",
        last_used_at AS "lastUsedAt"
      FROM mfa_enrollment
      WHERE organization_id = ${organizationId}
        AND user_id = ${userId}
        AND revoked_at IS NULL
      ORDER BY enrolled_at DESC
    `,
  );

  return rows;
}

/**
 * Starts TOTP enrolment and returns secret, uri, and generated recovery codes.
 */
export async function startTotpEnrollment(
  organizationId: string,
  userId: string,
  email: string,
): Promise<TotpEnrollmentDetails> {
  const secret = generateBase32Secret(20);
  const uri = generateTotpUri('TapCRM', email, secret);
  const recoveryCodes = generateRecoveryCodes(10);

  return { secret, uri, recoveryCodes };
}

/**
 * Confirms and activates MFA enrollment after initial code verification.
 */
export async function confirmTotpEnrollment(
  organizationId: string,
  userId: string,
  secret: string,
  code: string,
  recoveryCodes: readonly string[],
  label = 'Authenticator App',
): Promise<void> {
  if (!verifyTotpCode(secret, code)) {
    throw new Error('Invalid verification code. Please check your authenticator app.');
  }
  if (recoveryCodes.length < 1 || recoveryCodes.length > 20) {
    throw new Error('Invalid recovery-code set.');
  }

  await identityDb.transactionForOrganization(organizationId, async (tx) => {
    await tx.one(sql`
      INSERT INTO mfa_enrollment (organization_id, user_id, method, assurance, secret_ref, label)
      VALUES (${organizationId}, ${userId}, 'totp', 'high', ${secret}, ${label})
      RETURNING id
    `);

    for (const rc of recoveryCodes) {
      await tx.one(sql`
        INSERT INTO mfa_recovery_code (organization_id, user_id, code_hash)
        VALUES (${organizationId}, ${userId}, ${hashRecoveryCode(rc)})
        RETURNING id
      `);
    }

    await tx.query(sql`
      UPDATE app_user
      SET mfa_required = true, updated_at = NOW()
      WHERE organization_id = ${organizationId} AND id = ${userId}
    `);
  });
}

/**
 * ID-5b: Sends Email OTP for login verification.
 */
export async function triggerEmailOtp(
  organizationId: string,
  userId: string,
  email: string,
): Promise<void> {
  const code = Math.floor(100_000 + Math.random() * 900_000).toString();
  const codeHash = createHash('sha256').update(code).digest('hex');

  await emailOtpRedis.set(emailOtpKey(organizationId, userId), codeHash, 'EX', 600);

  await sendEmailOtp(email, code);
}

/**
 * Verifies MFA challenge during sign-in (TOTP, Email OTP, or Recovery Code).
 */
export async function verifyMfaFactor(
  organizationId: string,
  userId: string,
  method: 'totp' | 'email-otp' | 'recovery-code' | 'passkey',
  factorValue: string,
  ip: string | null,
): Promise<{ verified: boolean; assurance: MfaAssurance }> {
  if (method === 'passkey') {
    const response = JSON.parse(factorValue) as AuthenticationResponseJSON;
    return finishPasskeyAuthentication(organizationId, userId, response);
  }

  if (method === 'totp') {
    const enrollments = await bootstrapDb.readAs<{ id: string; secretRef: string }>(
      organizationId,
      sql`
        SELECT id, secret_ref AS "secretRef"
        FROM mfa_enrollment
        WHERE organization_id = ${organizationId}
          AND user_id = ${userId}
          AND method = 'totp'
          AND revoked_at IS NULL
      `,
    );

    for (const enr of enrollments) {
      if (verifyTotpCode(enr.secretRef, factorValue)) {
        await identityDb.transactionForOrganization(organizationId, async (tx) => {
          await tx.query(
            sql`UPDATE mfa_enrollment SET last_used_at = NOW() WHERE organization_id = ${organizationId} AND id = ${enr.id}`,
          );
        });
        return { verified: true, assurance: 'high' };
      }
    }
    return { verified: false, assurance: 'high' };
  }

  if (method === 'email-otp') {
    const key = emailOtpKey(organizationId, userId);
    const stored = await emailOtpRedis.get(key);
    if (!stored) return { verified: false, assurance: 'low' };
    const inputHash = createHash('sha256').update(factorValue).digest('hex');
    if (stored === inputHash) {
      await emailOtpRedis.del(key);
      return { verified: true, assurance: 'low' };
    }
    return { verified: false, assurance: 'low' };
  }

  if (method === 'recovery-code') {
    const inputHash = hashRecoveryCode(factorValue);

    const matches = await identityDb.transactionForOrganization(
      organizationId,
      async (tx) =>
        tx.query<{ id: string; userEmail: string | null }>(sql`
        UPDATE mfa_recovery_code
        SET used_at = NOW()
        WHERE organization_id = ${organizationId}
          AND user_id = ${userId}
          AND code_hash = ${inputHash}
          AND used_at IS NULL
        RETURNING id, (SELECT email FROM app_user WHERE organization_id = ${organizationId} AND id = ${userId} LIMIT 1) AS "userEmail"
      `),
    );

    const match = matches[0];
    if (match) {
      // ID-5c: Notify user when recovery code is consumed
      if (match.userEmail) {
        void sendRecoveryCodeUsedAlert(match.userEmail, ip);
        const admins = await bootstrapDb.readAs<{ email: string }>(
          organizationId,
          sql`SELECT email FROM app_user WHERE organization_id=${organizationId} AND account_type='super-admin' AND status='active' AND email IS NOT NULL LIMIT 5`,
        );
        for (const admin of admins)
          void sendRecoveryCodeUsedAdminAlert(admin.email, match.userEmail, ip);
      }
      return { verified: true, assurance: 'high' };
    }
    return { verified: false, assurance: 'high' };
  }

  return { verified: false, assurance: 'low' };
}

/**
 * Revokes an MFA enrollment.
 */
export async function revokeMfaEnrollment(
  organizationId: string,
  userId: string,
  enrollmentId: string,
): Promise<void> {
  await identityDb.transactionForOrganization(organizationId, async (tx) => {
    await tx.query(sql`
      UPDATE mfa_enrollment
      SET revoked_at = NOW()
      WHERE organization_id = ${organizationId}
        AND user_id = ${userId}
        AND id = ${enrollmentId}
        AND revoked_at IS NULL
    `);
  });
}

/** ID-5/ID-5d — WebAuthn/passkey registration options. */
export async function startPasskeyRegistration(
  organizationId: string,
  userId: string,
  email: string,
  displayName: string,
) {
  const config = loadConfig();
  const rpID = new URL(config.CORS_ORIGIN).hostname;
  const options = await generateRegistrationOptions({
    rpName: 'TapCRM',
    rpID,
    userName: email,
    userDisplayName: displayName,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    excludeCredentials: (await listPasskeys(organizationId, userId)).map((p) => ({
      id: p.credentialId,
      transports: p.transports as AuthenticatorTransportFuture[],
    })),
  });
  await identityDb.transactionForOrganization(organizationId, (tx) =>
    tx.query(
      sql`INSERT INTO webauthn_challenge(organization_id,user_id,challenge,kind,expires_at) VALUES(${organizationId},${userId},${options.challenge},'registration',NOW()+INTERVAL '5 minutes') ON CONFLICT(organization_id,user_id,kind) DO UPDATE SET challenge=EXCLUDED.challenge,expires_at=EXCLUDED.expires_at`,
    ),
  );
  return options;
}

export async function finishPasskeyRegistration(
  organizationId: string,
  userId: string,
  response: RegistrationResponseJSON,
  label = 'Passkey',
) {
  const rows = await bootstrapDb.readAs<{ challenge: string }>(
    organizationId,
    sql`SELECT challenge FROM webauthn_challenge WHERE organization_id=${organizationId} AND user_id=${userId} AND kind='registration' AND expires_at>NOW() LIMIT 1`,
  );
  if (!rows[0]) throw new Error('Passkey registration challenge expired.');
  const config = loadConfig();
  const rpID = new URL(config.CORS_ORIGIN).hostname;
  const verified = await verifyRegistrationResponse({
    response,
    expectedChallenge: rows[0].challenge,
    expectedOrigin: config.CORS_ORIGIN,
    expectedRPID: rpID,
  });
  if (!verified.verified || !verified.registrationInfo)
    throw new Error('Passkey registration failed.');
  const info = verified.registrationInfo;
  const credentialId =
    typeof info.credential.id === 'string'
      ? info.credential.id
      : Buffer.from(info.credential.id).toString('base64url');
  const publicKey = Buffer.from(info.credential.publicKey).toString('base64url');
  await identityDb.transactionForOrganization(organizationId, async (tx) => {
    await tx.query(
      sql`INSERT INTO passkey_credential(organization_id,user_id,credential_id,public_key,counter,transports,device_type,backed_up,label) VALUES(${organizationId},${userId},${credentialId},${publicKey},${info.credential.counter},${response.response.transports ?? []},${info.credentialDeviceType},${info.credentialBackedUp},${label})`,
    );
    await tx.query(
      sql`INSERT INTO mfa_enrollment(organization_id,user_id,method,assurance,secret_ref,label) VALUES(${organizationId},${userId},'passkey','high',${credentialId},${label})`,
    );
    await tx.query(
      sql`DELETE FROM webauthn_challenge WHERE organization_id=${organizationId} AND user_id=${userId} AND kind='registration'`,
    );
  });
  return { verified: true };
}

export async function startPasskeyAuthentication(organizationId: string, userId: string) {
  const config = loadConfig();
  const rpID = new URL(config.CORS_ORIGIN).hostname;
  const creds = await listPasskeys(organizationId, userId);
  if (!creds.length) throw new Error('No passkey is enrolled for this account.');
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    userVerification: 'preferred',
  });
  await identityDb.transactionForOrganization(organizationId, (tx) =>
    tx.query(
      sql`INSERT INTO webauthn_challenge(organization_id,user_id,challenge,kind,expires_at) VALUES(${organizationId},${userId},${options.challenge},'authentication',NOW()+INTERVAL '5 minutes') ON CONFLICT(organization_id,user_id,kind) DO UPDATE SET challenge=EXCLUDED.challenge,expires_at=EXCLUDED.expires_at`,
    ),
  );
  return options;
}

export async function finishPasskeyAuthentication(
  organizationId: string,
  userId: string,
  response: AuthenticationResponseJSON,
) {
  const challenges = await bootstrapDb.readAs<{ challenge: string }>(
    organizationId,
    sql`SELECT challenge FROM webauthn_challenge WHERE organization_id=${organizationId} AND user_id=${userId} AND kind='authentication' AND expires_at>NOW() LIMIT 1`,
  );
  const credentialId = Buffer.from(response.rawId, 'base64url').toString('base64url');
  const creds = await bootstrapDb.readAs<{
    id: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports: string[] | null;
  }>(
    organizationId,
    sql`SELECT id,credential_id AS "credentialId",public_key AS "publicKey",counter,transports FROM passkey_credential WHERE organization_id=${organizationId} AND user_id=${userId} AND credential_id=${credentialId} AND revoked_at IS NULL LIMIT 1`,
  );
  const c = creds[0];
  if (!challenges[0] || !c) throw new Error('Invalid passkey authentication challenge.');
  const config = loadConfig();
  const rpID = new URL(config.CORS_ORIGIN).hostname;
  const verified = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenges[0].challenge,
    expectedOrigin: config.CORS_ORIGIN,
    expectedRPID: rpID,
    credential: {
      id: c.credentialId,
      publicKey: Buffer.from(c.publicKey, 'base64url'),
      counter: c.counter,
      transports: c.transports as AuthenticatorTransportFuture[] | undefined,
    },
  });
  if (!verified.verified) throw new Error('Passkey authentication failed.');
  await identityDb.transactionForOrganization(organizationId, async (tx) => {
    await tx.query(
      sql`UPDATE passkey_credential SET counter=${verified.authenticationInfo.newCounter},last_used_at=NOW() WHERE organization_id=${organizationId} AND id=${c.id}`,
    );
    await tx.query(
      sql`UPDATE mfa_enrollment SET last_used_at=NOW() WHERE organization_id=${organizationId} AND user_id=${userId} AND method='passkey' AND secret_ref=${c.credentialId}`,
    );
    await tx.query(
      sql`DELETE FROM webauthn_challenge WHERE organization_id=${organizationId} AND user_id=${userId} AND kind='authentication'`,
    );
  });
  return { verified: true, assurance: 'high' as const };
}

async function listPasskeys(organizationId: string, userId: string) {
  return bootstrapDb.readAs<{
    id: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports: string[] | null;
    label: string | null;
  }>(
    organizationId,
    sql`SELECT id,credential_id AS "credentialId",public_key AS "publicKey",counter,transports,label FROM passkey_credential WHERE organization_id=${organizationId} AND user_id=${userId} AND revoked_at IS NULL ORDER BY created_at DESC`,
  );
}
export async function listUserPasskeys(organizationId: string, userId: string) {
  return listPasskeys(organizationId, userId);
}
export async function revokePasskey(organizationId: string, userId: string, id: string) {
  await identityDb.transactionForOrganization(organizationId, (tx) =>
    tx.query(
      sql`UPDATE passkey_credential SET revoked_at=NOW() WHERE organization_id=${organizationId} AND user_id=${userId} AND id=${id} AND revoked_at IS NULL`,
    ),
  );
}
