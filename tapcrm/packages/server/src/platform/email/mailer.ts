import nodemailer, { type Transporter } from 'nodemailer';
import { emailTransport, loadConfig } from '../../config.js';
import { tapveraLogoAttachment } from './branding.js';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  /** Embed the logo so displaying it does not require loading a remote image. */
  readonly brandLogo?: 'tapvera-crm';
  /** Sensitive bodies must never be printed by the development console sender. */
  readonly sensitive?: boolean;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

let transporter: Transporter | null = null;

/**
 * SMTP transport. Host, port, TLS and credentials all come from SMTP_* config,
 * which loadConfig has already checked is complete (configurationProblems).
 * A relay that needs no login is used without one.
 */
function getTransporter(): Transporter {
  if (transporter) return transporter;
  const config = loadConfig();
  // A made-up fallback sender would send real mail from an address nobody owns.
  if (!config.SMTP_FROM?.trim()) throw new Error('SMTP_FROM is required when SMTP is configured');
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
  });
  return transporter;
}

/** Only an error's code: SMTP messages can echo addresses or server responses. */
function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : error.name;
  }
  return 'unknown';
}

/**
 * One startup line saying where email goes, and whether the SMTP server
 * accepts the connection and login, so a misconfigured server shows in the
 * log on boot instead of when someone's invitation never arrives. Never throws:
 * a mail server that is briefly down must not stop the API.
 */
export async function reportEmailTransport(): Promise<void> {
  const config = loadConfig();
  if (config.NODE_ENV === 'test') return;
  if (emailTransport(config) === 'console') {
    console.warn(JSON.stringify({
      level: config.NODE_ENV === 'production' ? 'warn' : 'info',
      msg: 'email is printed to this log, not sent (EMAIL_TRANSPORT=console)',
    }));
    return;
  }
  try {
    await getTransporter().verify();
    console.log(JSON.stringify({ level: 'info', msg: 'email: SMTP server reachable and login accepted', host: config.SMTP_HOST }));
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'email: SMTP check failed; messages will be retried but may not be delivered',
      host: config.SMTP_HOST,
      reason: errorCode(error),
    }));
  }
}

/** Test-only. */
export function __resetTransporter(): void {
  transporter = null;
}

function printToConsole(message: EmailMessage): void {
  console.log('\n--- [EMAIL - CONSOLE] ---');
  console.log(`To: ${message.to}`);
  console.log(`Subject: ${message.subject}`);
  console.log(message.sensitive ? 'Body: [sensitive content omitted]' : `Body:\n${message.text}`);
  console.log('-------------------------\n');
}

/** Delivers one message. Called only by the email worker. Throws on SMTP failure so BullMQ retries. */
export async function deliverEmail(message: EmailMessage): Promise<void> {
  const config = loadConfig();
  if (config.NODE_ENV === 'test') return;

  if (emailTransport(config) === 'console') {
    printToConsole(message);
    return;
  }
  if (config.NODE_ENV === 'development') printToConsole(message);

  await getTransporter().sendMail({
    from: config.SMTP_FROM?.trim(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(message.brandLogo === 'tapvera-crm' ? { attachments: [tapveraLogoAttachment] } : {}),
  });
}
