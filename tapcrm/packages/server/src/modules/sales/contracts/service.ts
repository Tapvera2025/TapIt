/**
 * Sales v1.1 R2 — Contracts service (R2 plan step 2.12).
 *
 * State machine:
 *
 *   draft → sent → signed
 *   draft → voided
 *   sent  → voided
 *   signed (old) → amended    (via `amend` creating a new draft)
 *
 * Signed rows are read-only — material revisions after signing require
 * `amend`, which creates a NEW draft row linked back via `supersedes_id`
 * and flips the previous signed row to state `amended`. The audit trail
 * never erases a signed contract.
 */

import type { Resource } from '@tapcrm/authz';
import { ApplicationError } from '../../../errors.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { DealResource } from '../deals/types.js';
import {
  findActiveContractForDealTx,
  findContract,
  findContractTx,
  insertContract,
  insertContractAudit,
  listContractsForDeal,
  loadDealContext,
  lockContract,
  markAmended,
  markSent as markSentRow,
  markSigned,
  markVoided,
  updateDealContractStatus,
} from './repository.js';
import type { Contract, SignerEvidence } from './types.js';
import type {
  AmendContractInput,
  CreateDraftInput,
  MarkSentInput,
  RecordSignatureInput,
  VoidContractInput,
} from './validators.js';

export class ContractNotFoundError extends ApplicationError {
  constructor() {
    super('Contract not found', 404, 'CONTRACT_NOT_FOUND');
    this.name = 'ContractNotFoundError';
  }
}

export class ContractWrongStateError extends ApplicationError {
  constructor(state: string, allowed: readonly string[]) {
    super(
      `Contract is ${state}; expected one of ${allowed.join(', ')}.`,
      409,
      'CONTRACT_WRONG_STATE',
      { state, allowed },
    );
    this.name = 'ContractWrongStateError';
  }
}

export class ContractDealClosedError extends ApplicationError {
  constructor(lifecycleStatus: string) {
    super(
      `Deal lifecycle is ${lifecycleStatus}; contract actions are not permitted.`,
      409,
      'CONTRACT_DEAL_CLOSED',
      { lifecycleStatus },
    );
    this.name = 'ContractDealClosedError';
  }
}

export class ContractCommercialsNotPublishedError extends ApplicationError {
  constructor(state: string) {
    super(
      `Commercials version is ${state}; contracts can only reference a published version.`,
      422,
      'CONTRACT_COMMERCIALS_NOT_PUBLISHED',
      { state },
    );
    this.name = 'ContractCommercialsNotPublishedError';
  }
}

export class ContractActiveExistsError extends ApplicationError {
  constructor(contractId: string, state: string) {
    super(
      `An active contract already exists for this deal; void or amend it first.`,
      409,
      'CONTRACT_ACTIVE_EXISTS',
      { contractId, state },
    );
    this.name = 'ContractActiveExistsError';
  }
}

/**
 * Resource loader for route-level authorization — contracts share their
 * parent deal's authz surface (same pattern as proposals/commercials).
 */
export async function loadDealForContract(ctx: RequestContext, contractId: string): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    responsibleCloserId: string;
    originatingAgentId: string;
    lifecycleStatus: string;
  }>(
    ctx,
    sql`SELECT d.id,
               d.organization_id       AS "organizationId",
               d.responsible_closer_id AS "responsibleCloserId",
               d.originating_agent_id  AS "originatingAgentId",
               d.lifecycle_status      AS "lifecycleStatus"
          FROM contract c
          JOIN deal d ON d.organization_id = c.organization_id AND d.id = c.deal_id
         WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${contractId}`,
  );
  if (!row) return null;
  const resource: DealResource = {
    type: 'deal',
    ...row,
    lifecycleStatus: row.lifecycleStatus as DealResource['lifecycleStatus'],
  };
  return resource;
}

export async function getContract(ctx: RequestContext, id: string): Promise<Contract> {
  const row = await findContract(ctx, id);
  if (!row) throw new ContractNotFoundError();
  return row;
}

export async function listForDeal(ctx: RequestContext, dealId: string): Promise<readonly Contract[]> {
  return listContractsForDeal(ctx, dealId);
}

interface CommercialsVersionSnapshot {
  readonly id: string;
  readonly dealId: string;
  readonly state: string;
}

async function loadCommercialsForContract(
  tx: Parameters<typeof findActiveContractForDealTx>[0],
  organizationId: string,
  commercialsId: string,
): Promise<CommercialsVersionSnapshot | null> {
  return tx.maybeOne<CommercialsVersionSnapshot>(sql`
    SELECT id,
           deal_id AS "dealId",
           state
      FROM commercials
     WHERE organization_id = ${organizationId}
       AND id              = ${commercialsId}
  `);
}

export async function createDraft(
  ctx: RequestContext,
  dealId: string,
  input: CreateDraftInput,
): Promise<Contract> {
  const contractId = await db.transaction(ctx, async (tx) => {
    const deal = await loadDealContext(tx, ctx.organizationId, dealId);
    if (!deal) throw new ApplicationError('Deal not found', 404, 'DEAL_NOT_FOUND');
    if (deal.lifecycleStatus !== 'open') {
      throw new ContractDealClosedError(deal.lifecycleStatus);
    }

    const commercials = await loadCommercialsForContract(tx, ctx.organizationId, input.commercialsId);
    if (!commercials) {
      throw new ApplicationError('Commercials not found', 404, 'COMMERCIALS_NOT_FOUND');
    }
    if (commercials.dealId !== dealId) {
      throw new ApplicationError(
        'Commercials belongs to a different deal.',
        422,
        'CONTRACT_COMMERCIALS_MISMATCH',
      );
    }
    if (commercials.state !== 'published' && commercials.state !== 'accepted') {
      throw new ContractCommercialsNotPublishedError(commercials.state);
    }

    const active = await findActiveContractForDealTx(tx, ctx.organizationId, dealId);
    if (active) {
      throw new ContractActiveExistsError(active.id, active.state);
    }

    const id = await insertContract(tx, ctx.organizationId, {
      dealId,
      commercialsId: input.commercialsId,
      draftFileId: input.draftFileId ?? null,
      supersedesId: null,
      createdBy: ctx.principal.id,
    });
    await updateDealContractStatus(tx, ctx.organizationId, dealId, 'draft');
    await insertContractAudit(tx, ctx, 'contract.draft_created', id, null, {
      dealId,
      commercialsId: input.commercialsId,
    });
    return id;
  });

  const created = await findContract(ctx, contractId);
  if (!created) throw new ContractNotFoundError();
  return created;
}

export async function markSent(
  ctx: RequestContext,
  contractId: string,
  input: MarkSentInput,
): Promise<Contract> {
  const now = new Date();

  await db.transaction(ctx, async (tx) => {
    const locked = await lockContract(tx, ctx.organizationId, contractId);
    if (!locked) throw new ContractNotFoundError();
    if (locked.state !== 'draft') {
      throw new ContractWrongStateError(locked.state, ['draft']);
    }

    const deal = await loadDealContext(tx, ctx.organizationId, locked.dealId);
    if (!deal) throw new ApplicationError('Deal not found', 404, 'DEAL_NOT_FOUND');
    if (deal.lifecycleStatus !== 'open') {
      throw new ContractDealClosedError(deal.lifecycleStatus);
    }

    await markSentRow(
      tx,
      ctx.organizationId,
      contractId,
      input.signerName,
      input.signerEmail,
      input.draftFileId ?? null,
      now,
    );
    await updateDealContractStatus(tx, ctx.organizationId, locked.dealId, 'sent');
    await insertContractAudit(tx, ctx, 'contract.sent', contractId,
      { state: 'draft' },
      { state: 'sent', signerEmail: input.signerEmail },
    );
  });

  const updated = await findContract(ctx, contractId);
  if (!updated) throw new ContractNotFoundError();
  return updated;
}

export async function recordSignature(
  ctx: RequestContext,
  contractId: string,
  input: RecordSignatureInput,
): Promise<Contract> {
  const now = new Date();

  await db.transaction(ctx, async (tx) => {
    const locked = await lockContract(tx, ctx.organizationId, contractId);
    if (!locked) throw new ContractNotFoundError();
    if (locked.state !== 'sent') {
      throw new ContractWrongStateError(locked.state, ['sent']);
    }

    const deal = await loadDealContext(tx, ctx.organizationId, locked.dealId);
    if (!deal) throw new ApplicationError('Deal not found', 404, 'DEAL_NOT_FOUND');
    if (deal.lifecycleStatus !== 'open') {
      throw new ContractDealClosedError(deal.lifecycleStatus);
    }

    const evidence: SignerEvidence = {
      ...input.signerEvidence,
      ip: input.signerEvidence.ip ?? ctx.sourceIp ?? null,
      signedAt: input.signerEvidence.signedAt ?? now.toISOString(),
    };

    await markSigned(
      tx,
      ctx.organizationId,
      contractId,
      input.signedFileId,
      input.checksum,
      evidence,
      now,
    );
    await updateDealContractStatus(tx, ctx.organizationId, locked.dealId, 'signed');
    await insertContractAudit(tx, ctx, 'contract.signed', contractId,
      { state: 'sent' },
      { state: 'signed', checksum: input.checksum },
    );
  });

  const updated = await findContract(ctx, contractId);
  if (!updated) throw new ContractNotFoundError();
  return updated;
}

export async function voidContract(
  ctx: RequestContext,
  contractId: string,
  input: VoidContractInput,
): Promise<Contract> {
  const now = new Date();

  await db.transaction(ctx, async (tx) => {
    const locked = await lockContract(tx, ctx.organizationId, contractId);
    if (!locked) throw new ContractNotFoundError();
    if (locked.state !== 'draft' && locked.state !== 'sent' && locked.state !== 'signed') {
      throw new ContractWrongStateError(locked.state, ['draft', 'sent', 'signed']);
    }

    const before = { state: locked.state };
    await markVoided(tx, ctx.organizationId, contractId, input.reason, now);

    // Reflect onto deal only if this was the active one. If it has been
    // superseded by an amendment, the deal's `contract_status` already
    // points at the newer row.
    const active = await findActiveContractForDealTx(tx, ctx.organizationId, locked.dealId);
    if (!active) {
      await updateDealContractStatus(tx, ctx.organizationId, locked.dealId, 'voided');
    }

    await insertContractAudit(tx, ctx, 'contract.voided', contractId, before, {
      state: 'voided',
      reason: input.reason,
    });
  });

  const updated = await findContract(ctx, contractId);
  if (!updated) throw new ContractNotFoundError();
  return updated;
}

/**
 * Amend a signed contract. Creates a new draft row that references the
 * signed one via `supersedes_id`, and flips the signed row to `amended`.
 * The new amendment then flows through the normal draft → sent → signed
 * lifecycle.
 */
export async function amend(
  ctx: RequestContext,
  oldContractId: string,
  input: AmendContractInput,
): Promise<Contract> {
  const now = new Date();

  const newId = await db.transaction(ctx, async (tx) => {
    const old = await lockContract(tx, ctx.organizationId, oldContractId);
    if (!old) throw new ContractNotFoundError();
    if (old.state !== 'signed') {
      throw new ContractWrongStateError(old.state, ['signed']);
    }

    const deal = await loadDealContext(tx, ctx.organizationId, old.dealId);
    if (!deal) throw new ApplicationError('Deal not found', 404, 'DEAL_NOT_FOUND');
    if (deal.lifecycleStatus !== 'open') {
      throw new ContractDealClosedError(deal.lifecycleStatus);
    }

    const commercials = await loadCommercialsForContract(tx, ctx.organizationId, input.commercialsId);
    if (!commercials) {
      throw new ApplicationError('Commercials not found', 404, 'COMMERCIALS_NOT_FOUND');
    }
    if (commercials.dealId !== old.dealId) {
      throw new ApplicationError(
        'Commercials belongs to a different deal.',
        422,
        'CONTRACT_COMMERCIALS_MISMATCH',
      );
    }
    if (commercials.state !== 'published' && commercials.state !== 'accepted') {
      throw new ContractCommercialsNotPublishedError(commercials.state);
    }

    const newContractId = await insertContract(tx, ctx.organizationId, {
      dealId: old.dealId,
      commercialsId: input.commercialsId,
      draftFileId: input.draftFileId ?? null,
      supersedesId: oldContractId,
      createdBy: ctx.principal.id,
    });
    await markAmended(tx, ctx.organizationId, oldContractId, now);
    await updateDealContractStatus(tx, ctx.organizationId, old.dealId, 'draft');

    await insertContractAudit(tx, ctx, 'contract.amended', oldContractId,
      { state: 'signed' },
      { state: 'amended', supersededBy: newContractId },
    );
    await insertContractAudit(tx, ctx, 'contract.draft_created', newContractId,
      null,
      { dealId: old.dealId, commercialsId: input.commercialsId, supersedesId: oldContractId },
    );
    return newContractId;
  });

  const created = await findContract(ctx, newId);
  if (!created) throw new ContractNotFoundError();
  return created;
}
