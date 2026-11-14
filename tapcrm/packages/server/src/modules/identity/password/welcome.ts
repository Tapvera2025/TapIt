import { loadConfig } from '../../../config.js';
import { createOpaqueToken, hashToken } from '../../../platform/auth/crypto.js';
import { bootstrapDb, db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { escapeHtml, sendEmail } from '../../../platform/email/index.js';
import { createIdentityContext } from '../authentication/principal.js';
import { findUserById } from '../repository.js';

const WELCOME_TTL_HOURS = 72;

/**
 * Emails a newly created account a welcome message with a link to choose its
 * own password. Reuses the password-reset token and `/reset-password` page, so
 * the link is single-use and consuming it revokes any existing session.
 * Callers run this after their transaction commits and must not let a delivery
 * failure fail the request.
 */
export async function sendWelcomePasswordSetup(input: { userId: string; organizationId: string }): Promise<void> {
  const user = await findUserById(input.userId, input.organizationId);
  if (!user || user.status !== 'active') return;
  const organization = await bootstrapDb.readAs<{ code: string }>(input.organizationId, sql`
    SELECT code FROM organization WHERE id = ${input.organizationId}
  `);
  const organizationCode = organization[0]?.code;
  if (!organizationCode) return;

  const token = createOpaqueToken(32);
  const expiresAt = new Date(Date.now() + WELCOME_TTL_HOURS * 3600 * 1000);
  await db.transaction(createIdentityContext(user, `identity:welcome-setup:${user.id}`), async (tx) => {
    await tx.query(sql`UPDATE password_reset_token SET used_at = now() WHERE organization_id = ${input.organizationId} AND user_id = ${user.id} AND used_at IS NULL`);
    await tx.query(sql`INSERT INTO password_reset_token(organization_id, user_id, token_hash, expires_at) VALUES (${input.organizationId}, ${user.id}, ${hashToken(token)}, ${expiresAt})`);
  });

  const config = loadConfig();
  const url = `${config.CLIENT_ORIGIN}/reset-password?token=${encodeURIComponent(token)}&org=${encodeURIComponent(organizationCode)}`;
  const safeUrl = escapeHtml(url);
  const safeName = escapeHtml(user.fullName ?? '');
  await sendEmail({
    to: user.email,
    subject: 'Welcome to TapCRM — set your password',
    text: [
      `Welcome to TapCRM${user.fullName ? `, ${user.fullName}` : ''}.`,
      '',
      'Your client account has been created.',
      'Choose your password using the secure link below:',
      url,
      '',
      `This link expires in ${WELCOME_TTL_HOURS} hours and can only be used once.`,
      'If you were not expecting this email, contact your account manager.',
    ].join('\n'),
    html: [
      '<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">',
      '<h2>Welcome to TapCRM</h2>',
      `<p>${safeName ? `Hello <strong>${safeName}</strong>, your` : 'Your'} client account has been created.</p>`,
      '<p>Choose your password to get started:</p>',
      `<p><a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Set Password</a></p>`,
      `<p style="font-size: 13px; color: #64748b;">This link is single-use and expires in ${WELCOME_TTL_HOURS} hours.</p>`,
      '<p style="font-size: 12px; color: #94a3b8;">If you were not expecting this email, you can safely ignore it.</p>',
      '</div>',
    ].join(''),
    sensitive: true,
  });
}
