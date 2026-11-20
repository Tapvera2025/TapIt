import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from '../../config.js';
import type { EmailMessage } from './mailer.js';
import { recordQueued } from './log.js';

export const EMAIL_QUEUE = 'email-queue';
export const EMAIL_ATTEMPTS = 3;
export const EMAIL_BACKOFF_MS = 5_000;

/** The rendered body of an email. */
export type EmailTemplateData = Pick<EmailMessage, 'text' | 'html' | 'sensitive' | 'brandLogo'>;

let connection: Redis | null = null;
/** A message in the queue, with the id of its Mail Center record. */
export type QueuedEmail = EmailMessage & { readonly logId?: string };

let queue: Queue<QueuedEmail> | null = null;

function getQueue(): Queue<QueuedEmail> {
  if (queue) return queue;
  connection = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue<QueuedEmail>(EMAIL_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: EMAIL_ATTEMPTS,
      backoff: { type: 'exponential', delay: EMAIL_BACKOFF_MS },
      // Bodies can hold one-time codes and reset links, so a finished job is
      // not kept in Redis, and a failed one is kept only briefly for diagnosis.
      removeOnComplete: true,
      removeOnFail: { age: 24 * 60 * 60, count: 1_000 },
    },
  });
  return queue;
}

/** Queues one email. The worker sends it, at most one per second. */
export async function addEmailToQueue(to: string, subject: string, templateData: EmailTemplateData): Promise<void> {
  // Tests have no Redis, and nothing is delivered in them anyway.
  if (loadConfig().NODE_ENV === 'test') return;
  const message: EmailMessage = { to, subject, ...templateData };
  // Recorded first so a message that never reaches the queue still shows up (as QUEUED).
  const logId = await recordQueued(message);
  await getQueue().add('send', { ...message, ...(logId ? { logId } : {}) });
}

/** Sends a message again from the Mail Center. Its log row already exists. */
export async function requeueEmail(logId: string, message: EmailMessage): Promise<void> {
  await getQueue().add('send', { ...message, logId });
}

/** Same as `addEmailToQueue`, for callers that already hold a whole message. */
export function sendEmail(message: EmailMessage): Promise<void> {
  const { to, subject, ...templateData } = message;
  return addEmailToQueue(to, subject, templateData);
}

export async function closeEmailQueue(): Promise<void> {
  await queue?.close();
  await connection?.quit();
  queue = null;
  connection = null;
}
