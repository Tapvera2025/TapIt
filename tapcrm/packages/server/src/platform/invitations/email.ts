export interface InvitationEmail {
  to: string;
  organizationName: string;
  invitationUrl: string;
  expiresAt: Date;
}

/**
 * Delivery adapter. Development logs the URL so the complete flow can be tested
 * without SMTP. Production can point INVITATION_EMAIL_WEBHOOK_URL at the
 * transactional email service; the raw token is never stored in PostgreSQL.
 */
export async function sendAdminInvitation(input: InvitationEmail): Promise<void> {
  const webhook = process.env['INVITATION_EMAIL_WEBHOOK_URL'];
  if (process.env['NODE_ENV'] !== 'production' && !webhook) {
    console.info(
      JSON.stringify({
        level: 'info',
        msg: 'admin invitation created',
        to: input.to,
        organizationName: input.organizationName,
        invitationUrl: input.invitationUrl,
        expiresAt: input.expiresAt.toISOString(),
      }),
    );
    return;
  }
  if (!webhook)
    throw new Error('Invitation email delivery is not configured for production');
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      to: input.to,
      template: 'tapcrm-company-admin-invitation',
      organizationName: input.organizationName,
      invitationUrl: input.invitationUrl,
      expiresAt: input.expiresAt.toISOString(),
    }),
  });
  if (!response.ok)
    throw new Error(`Invitation email provider returned HTTP ${response.status}`);
}
