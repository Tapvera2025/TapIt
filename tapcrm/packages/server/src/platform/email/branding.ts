import { fileURLToPath } from 'node:url';

/** A mail-sized copy of the same Tapvera CRM logo used in the web app. */
export const tapveraLogoAttachment = {
  filename: 'tapvera-crm.png',
  path: fileURLToPath(new URL('../../../assets/email/tapvera-crm.png', import.meta.url)),
  contentType: 'image/png',
  contentDisposition: 'inline',
  cid: 'tapvera-crm-logo@tapvera.io',
} as const;
