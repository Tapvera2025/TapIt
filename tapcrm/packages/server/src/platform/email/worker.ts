import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from '../../config.js';
import { deliverEmail, reportEmailTransport } from './mailer.js';
import { markAttemptFailed, markSent } from './log.js';
import { EMAIL_ATTEMPTS, EMAIL_QUEUE, closeEmailQueue, type QueuedEmail } from './queue.js';

let connection: Redis | null = null;
let worker: Worker<QueuedEmail> | null = null;

/**
 * Only the error's code is logged. SMTP error messages can echo the recipient
 * address or server response, and the job data holds the message body.
 */
function safeReason(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : error.name;
  }
  return 'unknown';
}

/** Delivers one message and records the outcome of this attempt in the Mail Center. */
async function processEmail(job: Job<QueuedEmail>): Promise<void> {
  const attempt = job.attemptsMade + 1;
  try {
    await deliverEmail(job.data);
  } catch (error) {
    await markAttemptFailed(job.data.logId, attempt, error, attempt >= EMAIL_ATTEMPTS);
    throw error;
  }
  await markSent(job.data.logId, attempt);
}

export function startEmailWorker(): void {
  if (worker) return;
  connection = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  worker = new Worker<QueuedEmail>(EMAIL_QUEUE, processEmail, {
    connection,
    // Protects the SMTP server's rate threshold: one job per second, however many workers.
    limiter: { max: 1, duration: 1000 },
  });
  worker.on('failed', (job, error) => {
    const attempt = job?.attemptsMade ?? 0;
    console.error(
      JSON.stringify({
        level: 'error',
        msg: attempt >= EMAIL_ATTEMPTS ? 'email failed permanently' : 'email attempt failed',
        jobId: job?.id,
        attempt,
        reason: safeReason(error),
      }),
    );
  });
  worker.on('error', (error) => {
    console.error(JSON.stringify({ level: 'error', msg: 'email worker error', reason: safeReason(error) }));
  });
  void reportEmailTransport();
}

export async function stopEmailWorker(): Promise<void> {
  await worker?.close();
  await connection?.quit();
  await closeEmailQueue();
  worker = null;
  connection = null;
}
