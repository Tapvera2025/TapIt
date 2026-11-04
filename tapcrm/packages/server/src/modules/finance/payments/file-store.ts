import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../../config.js';
export async function storeBankImport(organizationId:string,filename:string,data:Buffer){const base=resolve(loadConfig().TAPCRM_UPLOAD_DIR);const stored=`${randomUUID()}.csv`;const relative=join('finance-bank-imports',organizationId,stored);const absolute=resolve(base,relative);if(!absolute.startsWith(`${base}/`))throw new Error('PAYMENT_FILE_PATH_INVALID');await mkdir(join(base,'finance-bank-imports',organizationId),{recursive:true});await writeFile(absolute,data,{flag:'wx'});return {storedFilename:stored,relativePath:relative,sha256:createHash('sha256').update(data).digest('hex')};}
export async function readBankImport(relativePath:string){const base=resolve(loadConfig().TAPCRM_UPLOAD_DIR);const absolute=resolve(base,relativePath);if(!absolute.startsWith(`${base}/`))throw new Error('PAYMENT_FILE_PATH_INVALID');return readFile(absolute);}
