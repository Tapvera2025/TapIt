import nodemailer, { type Transporter } from 'nodemailer';
import { loadConfig } from '../../config.js';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
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

function hasSmtpConfig(): boolean {
  const config = loadConfig();
  return Boolean(config.SMTP_HOST && config.SMTP_PORT && config.SMTP_USER && config.SMTP_PASSWORD);
}

/** SMTP transport. Host, port, TLS and credentials all come from SMTP_* config. */
function getTransporter(): Transporter {
  if (transporter) return transporter;
  const config = loadConfig();
  // A made-up fallback sender would send real mail from an address nobody owns.
  if (!config.SMTP_FROM?.trim()) throw new Error('SMTP_FROM is required when SMTP is configured');
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
  });
  return transporter;
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

  if (!hasSmtpConfig()) {
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
  });
}
