import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../../config.js';
export async function storeInvoicePdf(organizationId:string, invoiceId:string, body:Buffer) { const base=resolve(loadConfig().TAPCRM_UPLOAD_DIR); const name=`${randomUUID()}.pdf`; const relative=join('finance-invoices',organizationId,invoiceId,name); const absolute=resolve(base,relative); if(!absolute.startsWith(`${base}/`)) throw new Error('INVOICE_FILE_PATH_INVALID'); await mkdir(join(base,'finance-invoices',organizationId,invoiceId),{recursive:true}); await writeFile(absolute,body,{flag:'wx'}); return {relativePath:relative,sha256:createHash('sha256').update(body).digest('hex')}; }
export async function readInvoicePdf(relativePath:string) { const base=resolve(loadConfig().TAPCRM_UPLOAD_DIR); const absolute=resolve(base,relativePath); if(!absolute.startsWith(`${base}/`)) throw new Error('INVOICE_FILE_PATH_INVALID'); return readFile(absolute); }
