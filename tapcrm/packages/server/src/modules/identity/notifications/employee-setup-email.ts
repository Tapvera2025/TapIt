import { tapveraLogoAttachment } from '../../../platform/email/branding.js';
import { escapeHtml, type EmailMessage } from '../../../platform/email/mailer.js';

interface EmployeeSetupEmailInput {
  readonly to: string;
  readonly setupUrl: string;
  readonly expiresHours: number;
  readonly fullName?: string | undefined;
}

/** Render both parts without contacting or queuing mail. */
export function renderEmployeeSetupEmail(input: EmployeeSetupEmailInput): EmailMessage {
  const name = input.fullName?.trim();
  const greeting = name ? `Hi ${name},` : 'Hello,';
  const htmlGreeting = name ? `Hi <strong>${escapeHtml(name)}</strong>,` : 'Hello,';
  const safeUrl = escapeHtml(input.setupUrl);
  const expires = `This link can be used once and expires in ${input.expiresHours} ${input.expiresHours === 1 ? 'hour' : 'hours'}.`;
  const nextStep = 'Your employee account is ready. Set a password to finish setting up your access to Tapvera CRM.';

  return {
    to: input.to,
    subject: 'TapCRM — Employee Account Setup',
    brandLogo: 'tapvera-crm',
    sensitive: true,
    text: [
      greeting,
      '',
      nextStep,
      '',
      'Set up your password:',
      input.setupUrl,
      '',
      expires,
      'If the link has expired or you weren’t expecting this email, contact your organization administrator.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Set up your employee account</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f3ef;color:#1d2939;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">Set your password to activate your Tapvera CRM employee account.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f3ef" style="background-color:#f5f3ef;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="max-width:560px;background-color:#ffffff;border:1px solid #e4ded4;border-top:4px solid #e78a16;border-radius:16px;">
          <tr>
            <td style="padding:25px 26px 20px;border-bottom:1px solid #eee8df;">
              <img src="cid:${tapveraLogoAttachment.cid}" alt="Tapvera CRM" width="182" height="73" style="display:block;width:182px;max-width:100%;height:auto;border:0;color:#1d2939;font-size:22px;font-weight:bold;">
            </td>
          </tr>
          <tr>
            <td style="padding:26px 26px 28px;font-family:Arial,Helvetica,sans-serif;">
              <h1 style="margin:0 0 18px;font-size:29px;line-height:36px;letter-spacing:-0.6px;color:#172337;">Set up your employee account</h1>
              <p style="margin:0 0 8px;font-size:16px;line-height:25px;color:#344054;">${htmlGreeting}</p>
              <p style="margin:0 0 23px;font-size:16px;line-height:25px;color:#344054;">${nextStep}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" bgcolor="#f8b544" style="background-color:#f8b544;border:1px solid #e9a137;border-radius:9px;mso-padding-alt:14px 23px;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 23px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:21px;font-weight:bold;text-align:center;color:#251803;text-decoration:none;mso-padding-alt:0;">Set up your password</a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;">
                <tr>
                  <td bgcolor="#fff5e1" style="padding:12px 14px;border-left:3px solid #e78a16;border-radius:6px;background-color:#fff5e1;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#533615;">
                    <strong>Setup link:</strong> ${expires}
                  </td>
                </tr>
              </table>
              <p style="margin:22px 0 6px;font-size:13px;line-height:20px;color:#475467;">If the button doesn’t work, copy this link into your browser:</p>
              <p style="margin:0;font-size:13px;line-height:20px;overflow-wrap:anywhere;word-break:break-all;"><a href="${safeUrl}" style="color:#774404;text-decoration:underline;">${safeUrl}</a></p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#faf8f4" style="padding:18px 26px;border-top:1px solid #eee8df;border-radius:0 0 16px 16px;background-color:#faf8f4;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#475467;">
              If the link has expired or you weren’t expecting this email, contact your organization administrator.
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}
