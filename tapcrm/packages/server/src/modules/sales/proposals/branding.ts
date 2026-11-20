import { ApplicationError } from '../../../errors.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { proposalSenderSnapshot, type ProposalSender } from '../../organization/proposal-branding.js';

/** Drafts and older versions use the current brand. New publications keep their own. */
export async function getCommercialsSender(ctx: RequestContext, id: string): Promise<ProposalSender> {
  const row = await db.maybeOne<{ sender: ProposalSender }>(ctx, sql`
    SELECT COALESCE(sender_branding, (${proposalSenderSnapshot(ctx.organizationId)})) AS sender
      FROM commercials
     WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
  if (!row) throw new ApplicationError('Proposal version not found.', 404, 'COMMERCIALS_NOT_FOUND');
  return row.sender;
}
