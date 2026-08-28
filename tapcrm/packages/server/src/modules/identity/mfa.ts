import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { bootstrapDb, platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { sendEmailOtp, sendRecoveryCodeUsedAlert } from './email.js';

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

export interface EmailOtpState {
  readonly codeHash: string;
  readonly expiresAt: number;
}

// In-memory cache for pending email OTPs
const emailOtpStore = new Map<string, EmailOtpState>();

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
export function generateTotpUri(issuer: string, accountName: string, secret: string): string {
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
  const valid = verifyTotpCode(secret, code);
  if (!valid) {
    throw new Error('Invalid verification code. Please check your authenticator app.');
  }

  // Insert enrollment
  await platformDb.query(
    'health-check',
    'enroll totp mfa',
    sql`
      INSERT INTO mfa_enrollment (
        organization_id,
        user_id,
        method,
        assurance,
        secret_ref,
        label
      )
      VALUES (
        ${organizationId},
        ${userId},
        'totp',
        'high',
        ${secret},
        ${label}
      )
    `,
  );

  // Store hashed recovery codes (ID-5c)
  for (const rc of recoveryCodes) {
    const hash = hashRecoveryCode(rc);
    await platformDb.query(
      'health-check',
      'store mfa recovery code',
      sql`
        INSERT INTO mfa_recovery_code (
          organization_id,
          user_id,
          code_hash
        )
        VALUES (
          ${organizationId},
          ${userId},
          ${hash}
        )
      `,
    );
  }

  // Update app_user.mfa_required = true
  await platformDb.query(
    'health-check',
    'mark user mfa enabled',
    sql`
      UPDATE app_user
      SET mfa_required = true
      WHERE organization_id = ${organizationId}
        AND id = ${userId}
    `,
  );
}

/**
 * ID-5b: Sends Email OTP for login verification.
 */
export async function triggerEmailOtp(
  organizationId: string,
  userId: string,
  email: string,
): Promise<void> {
  const code = (Math.floor(100_000 + Math.random() * 900_000)).toString();
  const codeHash = createHash('sha256').update(code).digest('hex');

  emailOtpStore.set(`${organizationId}:${userId}`, {
    codeHash,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 mins
  });

  await sendEmailOtp(email, code);
}

/**
 * Verifies MFA challenge during sign-in (TOTP, Email OTP, or Recovery Code).
 */
export async function verifyMfaFactor(
  organizationId: string,
  userId: string,
  method: 'totp' | 'email-otp' | 'recovery-code',
  factorValue: string,
  ip: string | null,
): Promise<{ verified: boolean; assurance: MfaAssurance }> {
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
        await platformDb.query(
          'health-check',
          'update mfa last used',
          sql`UPDATE mfa_enrollment SET last_used_at = NOW() WHERE id = ${enr.id}`,
        );
        return { verified: true, assurance: 'high' };
      }
    }
    return { verified: false, assurance: 'high' };
  }

  if (method === 'email-otp') {
    const key = `${organizationId}:${userId}`;
    const stored = emailOtpStore.get(key);
    if (!stored || stored.expiresAt < Date.now()) {
      return { verified: false, assurance: 'low' };
    }

    const inputHash = createHash('sha256').update(factorValue).digest('hex');
    if (stored.codeHash === inputHash) {
      emailOtpStore.delete(key);
      return { verified: true, assurance: 'low' };
    }
    return { verified: false, assurance: 'low' };
  }

  if (method === 'recovery-code') {
    const inputHash = hashRecoveryCode(factorValue);

    const matches = await platformDb.query<{ id: string; userEmail: string | null }>(
      'health-check',
      'verify mfa recovery code',
      sql`
        UPDATE mfa_recovery_code
        SET used_at = NOW()
        WHERE organization_id = ${organizationId}
          AND user_id = ${userId}
          AND code_hash = ${inputHash}
          AND used_at IS NULL
        RETURNING id, (SELECT email FROM app_user WHERE id = ${userId} LIMIT 1) AS "userEmail"
      `,
    );

    const match = matches[0];
    if (match) {
      // ID-5c: Notify user when recovery code is consumed
      if (match.userEmail) {
        void sendRecoveryCodeUsedAlert(match.userEmail, ip);
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
  await platformDb.query(
    'health-check',
    'revoke mfa enrollment',
    sql`
      UPDATE mfa_enrollment
      SET revoked_at = NOW()
      WHERE organization_id = ${organizationId}
        AND user_id = ${userId}
        AND id = ${enrollmentId}
    `,
  );
}
