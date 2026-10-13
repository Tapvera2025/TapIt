/**
 * Sales v1.1 R2 — Contract repository (R2 plan step 2.12).
 *
 * Owns all SQL against `contract`. The service layer composes these
 * methods inside a `db.transaction`; no raw SQL leaks out of this file.
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { Contract, ContractState, SignerEvidence } from './types.js';

interface ContractRow {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly commercialsId: string;
  readonly state: ContractState;
  readonly draftFileId: string | null;
  readonly signedFileId: string | null;
  readonly checksum: string | null;
  readonly signerName: string | null;
  readonly signerEmail: string | null;
  readonly signerEvidence: SignerEvidence | null;
  readonly sentAt: Date | null;
  readonly signedAt: Date | null;
  readonly voidedAt: Date | null;
  readonly voidReason: string | null;
  readonly supersedesId: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const CONTRACT_SELECT = sql`
  SELECT c.id,
         c.organization_id   AS "organizationId",
         c.deal_id           AS "dealId",
         c.commercials_id    AS "commercialsId",
         c.state,
         c.draft_file_id     AS "draftFileId",
         c.signed_file_id    AS "signedFileId",
         c.checksum,
         c.signer_name       AS "signerName",
         c.signer_email      AS "signerEmail",
         c.signer_evidence   AS "signerEvidence",
         c.sent_at           AS "sentAt",
         c.signed_at         AS "signedAt",
         c.voided_at         AS "voidedAt",
         c.void_reason       AS "voidReason",
         c.supersedes_id     AS "supersedesId",
         c.created_by        AS "createdBy",
         c.created_at        AS "createdAt",
         c.updated_at        AS "updatedAt"
    FROM contract c
`;

function toContract(row: ContractRow): Contract {
  return row;
}

export async function findContract(ctx: RequestContext, id: string): Promise<Contract | null> {
  const row = await db.maybeOne<ContractRow>(
    ctx,
    sql`${CONTRACT_SELECT} WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${id}`,
  );
  return row ? toContract(row) : null;
}

export async function findContractTx(tx: Tx, organizationId: string, id: string): Promise<Contract | null> {
  const row = await tx.maybeOne<ContractRow>(
    sql`${CONTRACT_SELECT} WHERE c.organization_id = ${organizationId} AND c.id = ${id}`,
  );
  return row ? toContract(row) : null;
}

export async function listContractsForDeal(ctx: RequestContext, dealId: string): Promise<readonly Contract[]> {
  const rows = await db.query<ContractRow>(
    ctx,
    sql`${CONTRACT_SELECT}
         WHERE c.organization_id = ${ctx.organizationId}
           AND c.deal_id         = ${dealId}
         ORDER BY c.created_at DESC`,
  );
  return rows.map(toContract);
}

/**
 * The "active" contract is the latest row that is not in a superseded
 * terminal state. For readiness checks we need the signed one; for
 * drafting we want the latest draft. Callers filter by `state`.
 */
export async function findActiveContractForDeal(
  ctx: RequestContext,
  dealId: string,
): Promise<Contract | null> {
  const row = await db.maybeOne<ContractRow>(
    ctx,
    sql`${CONTRACT_SELECT}
         WHERE c.organization_id = ${ctx.organizationId}
           AND c.deal_id         = ${dealId}
           AND c.state NOT IN ('amended','replaced','voided')
         ORDER BY c.created_at DESC
         LIMIT 1`,
  );
  return row ? toContract(row) : null;
}

export async function findActiveContractForDealTx(
  tx: Tx,
  organizationId: string,
  dealId: string,
): Promise<Contract | null> {
  const row = await tx.maybeOne<ContractRow>(
    sql`${CONTRACT_SELECT}
         WHERE c.organization_id = ${organizationId}
           AND c.deal_id         = ${dealId}
           AND c.state NOT IN ('amended','replaced','voided')
         ORDER BY c.created_at DESC
         LIMIT 1`,
  );
  return row ? toContract(row) : null;
}

export interface LockedContract {
  readonly id: string;
  readonly dealId: string;
  readonly commercialsId: string;
  readonly state: ContractState;
  readonly signedAt: Date | null;
  readonly updatedAt: Date;
}

export async function lockContract(
  tx: Tx,
  organizationId: string,
  id: string,
): Promise<LockedContract | null> {
  return tx.maybeOne<LockedContract>(sql`
    SELECT id,
           deal_id        AS "dealId",
           commercials_id AS "commercialsId",
           state,
           signed_at      AS "signedAt",
           updated_at     AS "updatedAt"
      FROM contract
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
     FOR UPDATE
  `);
}

export interface InsertContractInput {
  readonly dealId: string;
  readonly commercialsId: string;
  readonly draftFileId: string | null;
  readonly supersedesId: string | null;
  readonly createdBy: string;
}

export async function insertContract(
  tx: Tx,
  organizationId: string,
  input: InsertContractInput,
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO contract (
      organization_id, deal_id, commercials_id, state,
      draft_file_id, supersedes_id, created_by
    ) VALUES (
      ${organizationId}, ${input.dealId}, ${input.commercialsId}, 'draft',
      ${input.draftFileId}, ${input.supersedesId}, ${input.createdBy}
    )
    RETURNING id
  `);
  return row.id;
}

export async function markSent(
  tx: Tx,
  organizationId: string,
  id: string,
  signerName: string,
  signerEmail: string,
  draftFileId: string | null,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE contract
       SET state          = 'sent',
           signer_name    = ${signerName},
           signer_email   = ${signerEmail},
           draft_file_id  = COALESCE(${draftFileId}, draft_file_id),
           sent_at        = ${now},
           updated_at     = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function markSigned(
  tx: Tx,
  organizationId: string,
  id: string,
  signedFileId: string,
  checksum: string,
  signerEvidence: SignerEvidence,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE contract
       SET state           = 'signed',
           signed_file_id  = ${signedFileId},
           checksum        = ${checksum},
           signer_evidence = ${JSON.stringify(signerEvidence)}::jsonb,
           signed_at       = ${now},
           updated_at      = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function markVoided(
  tx: Tx,
  organizationId: string,
  id: string,
  reason: string,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE contract
       SET state       = 'voided',
           void_reason = ${reason},
           voided_at   = ${now},
           updated_at  = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

/**
 * Mark a signed contract as `amended` when a new amendment supersedes it.
 * Preserves `signed_at`, so the audit trail still shows when the original
 * agreement was executed.
 */
export async function markAmended(
  tx: Tx,
  organizationId: string,
  id: string,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE contract
       SET state      = 'amended',
           updated_at = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

/**
 * Reflect the active contract's state onto `deal.contract_status`. Deal's
 * column uses a narrower enum (not_required/draft/sent/signed/voided); we
 * map `amended`/`replaced` back to the active contract's current state
 * at the call site, so this helper only accepts the deal enum values.
 */
export async function updateDealContractStatus(
  tx: Tx,
  organizationId: string,
  dealId: string,
  status: 'not_required' | 'draft' | 'sent' | 'signed' | 'voided',
): Promise<void> {
  await tx.query(sql`
    UPDATE deal
       SET contract_status = ${status},
           updated_at      = now()
     WHERE organization_id = ${organizationId}
       AND id              = ${dealId}
  `);
}

export interface DealContextSnapshot {
  readonly id: string;
  readonly lifecycleStatus: string;
  readonly contractStatus: string;
}

export async function loadDealContext(
  tx: Tx,
  organizationId: string,
  dealId: string,
): Promise<DealContextSnapshot | null> {
  return tx.maybeOne<DealContextSnapshot>(sql`
    SELECT id,
           lifecycle_status AS "lifecycleStatus",
           contract_status  AS "contractStatus"
      FROM deal
     WHERE organization_id = ${organizationId}
       AND id              = ${dealId}
  `);
}

export async function insertContractAudit(
  tx: Tx,
  ctx: RequestContext,
  action: string,
  contractId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
      action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'contract',
      targetId: contractId,
      before,
      after,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}
