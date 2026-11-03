import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from '../../config.js';
import { deliverEmail, type EmailMessage } from './mailer.js';
import { EMAIL_ATTEMPTS, EMAIL_QUEUE, closeEmailQueue } from './queue.js';

let connection: Redis | null = null;
let worker: Worker<EmailMessage> | null = null;

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

export function startEmailWorker(): void {
  if (worker) return;
  connection = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  worker = new Worker<EmailMessage>(EMAIL_QUEUE, (job: Job<EmailMessage>) => deliverEmail(job.data), {
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
}

export async function stopEmailWorker(): Promise<void> {
  await worker?.close();
  await connection?.quit();
  await closeEmailQueue();
  worker = null;
  connection = null;
}
