import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from '../../config.js';
import type { EmailMessage } from './mailer.js';

export const EMAIL_QUEUE = 'email-queue';
export const EMAIL_ATTEMPTS = 3;
export const EMAIL_BACKOFF_MS = 5_000;

/** The rendered body of an email. */
export type EmailTemplateData = Pick<EmailMessage, 'text' | 'html' | 'sensitive'>;

let connection: Redis | null = null;
let queue: Queue<EmailMessage> | null = null;

function getQueue(): Queue<EmailMessage> {
  if (queue) return queue;
  connection = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue<EmailMessage>(EMAIL_QUEUE, {
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
  await getQueue().add('send', { to, subject, ...templateData });
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
