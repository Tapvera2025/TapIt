import { emailTransport, loadConfig } from '../../config.js';
import { platformDb } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import type { EmailMessage } from './mailer.js';

/**
 * The permanent record behind the Master Admin's Mail Center (migration 0163).
 *
 * Writing to it must never stop mail from going out, and a failed log write must never
 * make a delivered message be sent a second time, so every writer here swallows its own
 * errors and only reports them to the server log.
 */

export type EmailStatus = 'QUEUED' | 'RETRYING' | 'SENT' | 'FAILED';
export const EMAIL_STATUSES: readonly EmailStatus[] = ['QUEUED', 'RETRYING', 'SENT', 'FAILED'];

export interface EmailLogSummary {
  id: string;
  toAddress: string;
  fromAddress: string | null;
  subject: string;
  status: EmailStatus;
  transport: 'smtp' | 'console';
  attempts: number;
  manualRetries: number;
  sensitive: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
}

export interface EmailLogDetail extends EmailLogSummary {
  bodyText: string | null;
  bodyHtml: string | null;
}

const SUMMARY_COLUMNS = sql`id, to_address, from_address, subject, status, transport, attempts, manual_retries,
  sensitive, error_code, error_message, created_at, last_attempt_at, sent_at`;

function report(action: string, error: unknown): void {
  console.error(JSON.stringify({ level: 'error', msg: `email log: could not ${action}`, reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown' }));
}

/** SMTP errors can be long and echo server banners; keep enough to explain, not to leak. */
export function describeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const raw = error as { code?: unknown; responseCode?: unknown };
    const code = typeof raw.code === 'string' ? raw.code : error.name;
    const responseCode = typeof raw.responseCode === 'number' ? ` (SMTP ${raw.responseCode})` : '';
    return { code, message: `${error.message}${responseCode}`.replace(/\s+/g, ' ').trim().slice(0, 500) };
  }
  return { code: 'unknown', message: 'Unknown error' };
}

/** Records a message as it is queued. Returns its log id, or null if it could not be recorded. */
export async function recordQueued(message: EmailMessage): Promise<string | null> {
  const config = loadConfig();
  const transport = emailTransport(config) === 'console' ? 'console' : 'smtp';
  const sensitive = message.sensitive === true;
  try {
    const row = await platformDb.one<{ id: string }>('email-log', 'record queued email', sql`
      INSERT INTO email_log (to_address, from_address, subject, sensitive, transport, body_text, body_html)
      VALUES (${message.to}, ${config.SMTP_FROM?.trim() ?? null}, ${message.subject}, ${sensitive}, ${transport},
              ${sensitive ? null : message.text}, ${sensitive ? null : (message.html ?? null)})
      RETURNING id
    `);
    return row.id;
  } catch (error) {
    report('record a queued email', error);
    return null;
  }
}

export async function markSent(id: string | undefined, attempts: number): Promise<void> {
  if (!id) return;
  try {
    await platformDb.query('email-log', 'mark email sent', sql`
      UPDATE email_log
      SET status = 'SENT', attempts = ${attempts}, sent_at = now(), last_attempt_at = now(), updated_at = now(),
          error_code = NULL, error_message = NULL
      WHERE id = ${id}
    `);
  } catch (error) {
    report('mark an email sent', error);
  }
}

export async function markAttemptFailed(id: string | undefined, attempts: number, error: unknown, final: boolean): Promise<void> {
  if (!id) return;
  const { code, message } = describeFailure(error);
  try {
    await platformDb.query('email-log', 'mark email attempt failed', sql`
      UPDATE email_log
      SET status = ${final ? 'FAILED' : 'RETRYING'}, attempts = ${attempts}, last_attempt_at = now(), updated_at = now(),
          error_code = ${code}, error_message = ${message}
      WHERE id = ${id}
    `);
  } catch (writeError) {
    report('mark an email attempt failed', writeError);
  }
}

export async function list(input: { page: number; limit: number; status?: EmailStatus; search?: string }): Promise<{ items: EmailLogSummary[]; totalCount: number }> {
  const status = input.status ? sql`AND status = ${input.status}` : sql``;
  const search = input.search ? sql`AND (to_address ILIKE ${`%${input.search}%`} OR subject ILIKE ${`%${input.search}%`})` : sql``;
  const offset = (input.page - 1) * input.limit;
  const [items, count] = await Promise.all([
    platformDb.query<EmailLogSummary>('email-log', 'list emails', sql`
      SELECT ${SUMMARY_COLUMNS} FROM email_log WHERE true ${status} ${search}
      ORDER BY created_at DESC, id DESC LIMIT ${input.limit} OFFSET ${offset}
    `),
    platformDb.one<{ total: string }>('email-log', 'count emails', sql`SELECT count(*)::text AS total FROM email_log WHERE true ${status} ${search}`),
  ]);
  return { items, totalCount: Number(count.total) };
}

export async function countsByStatus(): Promise<Record<EmailStatus, number>> {
  const rows = await platformDb.query<{ status: EmailStatus; total: string }>('email-log', 'count emails by status', sql`
    SELECT status, count(*)::text AS total FROM email_log GROUP BY status
  `);
  const counts: Record<EmailStatus, number> = { QUEUED: 0, RETRYING: 0, SENT: 0, FAILED: 0 };
  for (const row of rows) counts[row.status] = Number(row.total);
  return counts;
}

export function getDetail(id: string): Promise<EmailLogDetail | null> {
  return platformDb.maybeOne<EmailLogDetail>('email-log', 'read email', sql`
    SELECT ${SUMMARY_COLUMNS}, body_text, body_html FROM email_log WHERE id = ${id}
  `);
}

/** Puts a failed message back to QUEUED and returns what is needed to send it again. */
export async function claimForRetry(id: string): Promise<{ message: EmailMessage } | { reason: 'not-found' | 'not-failed' | 'no-body' }> {
  const row = await platformDb.maybeOne<{ toAddress: string; subject: string; bodyText: string | null; bodyHtml: string | null }>(
    'email-log', 'claim email for retry', sql`
      UPDATE email_log SET status = 'QUEUED', manual_retries = manual_retries + 1, updated_at = now()
      WHERE id = ${id} AND status = 'FAILED' AND body_text IS NOT NULL
      RETURNING to_address, subject, body_text, body_html
    `);
  if (row) {
    return { message: { to: row.toAddress, subject: row.subject, text: row.bodyText ?? '', ...(row.bodyHtml ? { html: row.bodyHtml } : {}) } };
  }
  const existing = await getDetail(id);
  if (!existing) return { reason: 'not-found' };
  if (existing.status !== 'FAILED') return { reason: 'not-failed' };
  return { reason: 'no-body' };
}
