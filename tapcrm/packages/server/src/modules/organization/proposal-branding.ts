import sharp from 'sharp';
import { z } from 'zod';
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export interface ProposalSender {
  readonly name: string;
  readonly logoDataUrl: string | null;
}

const MAX_LOGO_BYTES = 512 * 1024;
const MAX_DATA_URL_LENGTH = Math.ceil(MAX_LOGO_BYTES / 3) * 4 + 30;

export const proposalBrandingSchema = z.object({
  logoDataUrl: z.string().max(MAX_DATA_URL_LENGTH).nullable(),
}).strict();

export function proposalSenderSnapshot(organizationId: string) {
  return sql`
    SELECT jsonb_build_object(
      'name', COALESCE(NULLIF(btrim(legal_company_name), ''), name),
      'logoDataUrl', proposal_logo_data_url
    )
      FROM organization
     WHERE id = ${organizationId}
  `;
}

export async function getProposalBranding(ctx: RequestContext): Promise<ProposalSender> {
  const row = await db.one<{ sender: ProposalSender }>(ctx, sql`
    SELECT (${proposalSenderSnapshot(ctx.organizationId)}) AS sender
  `);
  return row.sender;
}

async function normalizeLogo(value: string): Promise<string> {
  const parts = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!parts?.[2]) {
    throw new ApplicationError('Choose a PNG or JPEG image.', 400, 'PROPOSAL_LOGO_INVALID');
  }
  try {
    const buffer = Buffer.from(parts[2], 'base64');
    if (buffer.length > MAX_LOGO_BYTES || buffer.toString('base64') !== parts[2]) {
      throw new Error('Invalid image data');
    }
    const input = sharp(buffer, { limitInputPixels: 12_000_000 });
    const { format } = await input.metadata();
    if (format !== parts[1]) throw new Error('Image format does not match');
    const png = await input.rotate().resize({
      width: 480,
      height: 240,
      fit: 'inside',
      withoutEnlargement: true,
    }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    throw new ApplicationError('Choose a readable PNG or JPEG image up to 512 KB.', 400, 'PROPOSAL_LOGO_INVALID');
  }
}

export async function updateProposalBranding(ctx: RequestContext, input: { logoDataUrl: string | null }): Promise<ProposalSender> {
  const logo = input.logoDataUrl === null ? null : await normalizeLogo(input.logoDataUrl);
  return db.one<ProposalSender>(ctx, sql`
    UPDATE organization
       SET proposal_logo_data_url = ${logo},
           updated_at = now()
     WHERE id = ${ctx.organizationId}
     RETURNING COALESCE(NULLIF(btrim(legal_company_name), ''), name) AS name,
               proposal_logo_data_url AS "logoDataUrl"
  `);
}
