export { addEmailToQueue, sendEmail, EMAIL_QUEUE } from './queue.js';
export type { EmailTemplateData } from './queue.js';
export { escapeHtml } from './mailer.js';
export type { EmailMessage } from './mailer.js';
export { startEmailWorker, stopEmailWorker } from './worker.js';
