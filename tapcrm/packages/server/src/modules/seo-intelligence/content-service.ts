import { randomUUID } from 'node:crypto';
import {
  globalAccess,
  type ContentDocument,
  type ContentVersion,
  type ContentEvent,
  type ContentSnapshot,
  type ContentBrand,
  type ContentCommentThread,
  contentBodyToPlainText,
} from '@tapcrm/contracts';
import { effectivePolicy } from '@tapcrm/authz';
import type { z } from 'zod';
import { ApplicationError } from '../../errors.js';
import { db, type Tx } from '../../platform/dal/db.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { sql } from '../../platform/dal/sql.js';
import { eligibleContentStaff, requireContentSite } from './content-policy.js';
import type {
  contentCreateSchema,
  contentSaveSchema,
  contentTransitionSchema,
  contentCommentCreateSchema,
} from './content-validators.js';

const notFound = () =>
  new ApplicationError(
    'This document is not available to you.',
    404,
    'CONTENT_NOT_FOUND',
  );
const conflict = () =>
  new ApplicationError(
    'A newer revision or review exists. Your text has not been overwritten. Reload the saved version before trying again.',
    409,
    'CONTENT_CONFLICT',
  );
const invalid = (message: string) =>
  new ApplicationError(message, 422, 'CONTENT_INVALID');
const selection = sql`SELECT d.*, owner.full_name AS owner_name, reviewer.full_name AS reviewer_name
  FROM seo_content_documents d JOIN app_user owner ON owner.organization_id = d.organization_id AND owner.id = d.owner_id
  LEFT JOIN app_user reviewer ON reviewer.organization_id = d.organization_id AND reviewer.id = d.reviewer_id`;

function documentAccess(ctx: RequestContext) {
  return globalAccess(ctx.principal)
    ? sql`TRUE`
    : sql`(d.owner_id = ${ctx.principal.id} OR d.reviewer_id = ${ctx.principal.id})`;
}
async function load(
  tx: Tx,
  ctx: RequestContext,
  siteId: string,
  id: string,
  lock = false,
) {
  const doc = await tx.maybeOne<ContentDocument>(sql`${selection}
    WHERE d.organization_id = ${ctx.organizationId} AND d.site_id = ${siteId} AND d.id = ${id}
    AND ${documentAccess(ctx)} ${lock ? sql`FOR UPDATE OF d` : sql``}`);
  if (!doc) throw notFound();
  return doc;
}
function requireEditor(ctx: RequestContext, doc: ContentDocument) {
  if (!globalAccess(ctx.principal) && doc.ownerId !== ctx.principal.id)
    throw new ApplicationError(
      'Only the assigned writer or an administrator can edit this draft.',
      403,
      'CONTENT_EDIT_FORBIDDEN',
    );
}
export function requireVersion(doc: Pick<ContentDocument, 'version'>, expected: number) {
  if (doc.version !== expected) throw conflict();
}
export function transitionStatus(
  doc: Pick<ContentDocument, 'status' | 'ownerId' | 'reviewerId' | 'snapshot'>,
  input: z.infer<typeof contentTransitionSchema>,
  actorId: string,
  administrator: boolean,
) {
  const review = input.transition === 'approve' || input.transition === 'request_changes';
  if (review) {
    if (actorId === doc.ownerId)
      throw new ApplicationError(
        'The writer cannot review their own content.',
        403,
        'CONTENT_SELF_REVIEW',
      );
    if (!administrator && actorId !== doc.reviewerId)
      throw new ApplicationError(
        'Only the assigned reviewer can make this decision.',
        403,
        'CONTENT_REVIEW_FORBIDDEN',
      );
    if (doc.status !== 'in_review') throw conflict();
    if (input.transition === 'request_changes' && !input.note)
      throw invalid('Explain which changes are needed.');
    return input.transition === 'approve' ? 'approved' : 'draft';
  }
  if (!administrator && actorId !== doc.ownerId)
    throw new ApplicationError(
      'Only the writer can change this workflow.',
      403,
      'CONTENT_EDIT_FORBIDDEN',
    );
  if (input.transition === 'submit') {
    if (doc.status !== 'draft') throw conflict();
    if (!doc.reviewerId) throw invalid('Choose a reviewer before submitting.');
    if (
      !doc.snapshot.body.trim() ||
      !doc.snapshot.audience.trim() ||
      !doc.snapshot.purpose.trim()
    )
      throw invalid('Add a draft, audience and purpose before submitting.');
    return 'in_review';
  }
  if (input.transition === 'archive') {
    if (doc.status === 'archived') throw conflict();
    return 'archived';
  }
  if (
    doc.status !== 'archived' &&
    doc.status !== 'in_review' &&
    doc.status !== 'approved'
  )
    throw conflict();
  return 'draft';
}
async function event(
  tx: Tx,
  ctx: RequestContext,
  doc: Pick<ContentDocument, 'id' | 'version'>,
  action: string,
  note = '',
) {
  await tx.query(sql`INSERT INTO seo_content_events (organization_id, document_id, version, actor_id, action, note)
    VALUES (${ctx.organizationId}, ${doc.id}, ${doc.version}, ${ctx.principal.id}, ${action}, ${note})`);
}
async function checkpoint(
  tx: Tx,
  ctx: RequestContext,
  doc: Pick<ContentDocument, 'id' | 'version' | 'snapshot'>,
  reason: string,
) {
  await tx.query(sql`INSERT INTO seo_content_versions (organization_id, document_id, version, snapshot, author_id, reason)
    VALUES (${ctx.organizationId}, ${doc.id}, ${doc.version}, ${JSON.stringify(doc.snapshot)}::jsonb, ${ctx.principal.id}, ${reason})`);
  await event(tx, ctx, doc, reason);
}
async function validateAssignment(
  tx: Tx,
  ctx: RequestContext,
  siteId: string,
  ownerId: string,
  reviewerId: string | null,
) {
  const members = await eligibleContentStaff(tx, ctx, siteId);
  if (
    !members.some((m) => m.id === ownerId) ||
    (reviewerId && !members.some((m) => m.id === reviewerId))
  )
    throw invalid('Select an active team member with access to this client.');
  if (ownerId === reviewerId) throw invalid('Choose a reviewer other than the writer.');
}
async function validateBrand(
  tx: Tx,
  ctx: RequestContext,
  siteId: string,
  snapshot: ContentSnapshot,
) {
  if (snapshot.brandVersion === null) return;
  const brand =
    await tx.maybeOne(sql`SELECT b.version FROM seo_content_brand_versions b JOIN seo_sites s ON s.organization_id = b.organization_id
    WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${siteId}
      AND b.scope_id = COALESCE(s.client_id, s.id) AND b.version = ${snapshot.brandVersion}`);
  if (!brand) throw invalid('The selected brand guidance version is unavailable.');
}
export async function listContent(ctx: RequestContext, siteId: string, offset = 0) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    const items =
      await tx.query<ContentDocument>(sql`${selection} WHERE d.organization_id = ${ctx.organizationId}
      AND d.site_id = ${siteId} AND ${documentAccess(ctx)} ORDER BY d.updated_at DESC, d.id LIMIT 25 OFFSET ${offset}`);
    const total = await tx.one<{
      total: number;
    }>(sql`SELECT count(*)::integer AS total FROM seo_content_documents d
      WHERE d.organization_id = ${ctx.organizationId} AND d.site_id = ${siteId} AND ${documentAccess(ctx)}`);
    return { items, total: total.total };
  });
}
export async function readContent(ctx: RequestContext, siteId: string, id: string) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, (tx) => load(tx, ctx, siteId, id));
}

/** Shared-editor access is re-evaluated at the socket boundary, not trusted from the client. */
export async function contentCollaborationAccess(ctx: RequestContext, id: string) {
  const readPermission = await effectivePolicy(ctx, 'seo:read-content');
  const administrator = globalAccess(ctx.principal);
  if (!administrator && !readPermission?.allowed) throw notFound();
  const record = await db.maybeOne<{ siteId: string }>(
    ctx,
    sql`
    SELECT site_id FROM seo_content_documents
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `,
  );
  if (!record) throw notFound();
  const doc = await readContent(ctx, record.siteId, id);
  const editPermission = await effectivePolicy(ctx, 'seo:edit-content');
  const editable =
    (administrator || editPermission?.allowed === true) &&
    (administrator || doc.ownerId === ctx.principal.id) &&
    doc.status !== 'archived';
  const actor = await db.maybeOne<{ displayName: string }>(
    ctx,
    sql`
    SELECT full_name AS display_name FROM app_user
    WHERE organization_id = ${ctx.organizationId} AND id = ${ctx.principal.id}
  `,
  );
  return {
    siteId: record.siteId,
    documentId: doc.id,
    organizationId: ctx.organizationId,
    userId: ctx.principal.id,
    displayName: actor?.displayName ?? 'TapCRM user',
    editable,
    status: doc.status,
    snapshot: doc.snapshot,
  };
}
export async function contentMembers(ctx: RequestContext, siteId: string) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, (tx) => eligibleContentStaff(tx, ctx, siteId));
}
export async function createContent(
  ctx: RequestContext,
  siteId: string,
  input: z.infer<typeof contentCreateSchema>,
) {
  await requireContentSite(ctx, siteId);
  const ownerId = input.ownerId ?? ctx.principal.id;
  if (ownerId !== ctx.principal.id && !globalAccess(ctx.principal))
    throw invalid(
      'Create your own draft; an administrator can assign drafts to another writer.',
    );
  return db.transaction(ctx, async (tx) => {
    await validateAssignment(tx, ctx, siteId, ownerId, input.reviewerId);
    await validateBrand(tx, ctx, siteId, input.snapshot);
    const briefId = randomUUID();
    const keywords = input.snapshot.keywords
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const outline = input.snapshot.outline
      .split(/\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    await tx.query(sql`INSERT INTO seo_content_briefs (id, organization_id, site_id, title, target_url, assigned_to, created_by, intent, outline, target_audience, requested_keywords, source_notes, meta_description, due_date)
      VALUES (${briefId}, ${ctx.organizationId}, ${siteId}, ${input.snapshot.title}, ${input.snapshot.targetUrl || null}, ${ownerId}, ${ctx.principal.id},
        ${input.snapshot.purpose || null}, ${JSON.stringify(outline)}::jsonb, ${input.snapshot.audience}, ${keywords}, ${input.snapshot.sources}, ${input.snapshot.metaDescription}, ${input.snapshot.dueDate || null}::date)`);
    const doc =
      await tx.one<ContentDocument>(sql`INSERT INTO seo_content_documents (organization_id, site_id, brief_id, owner_id, reviewer_id, snapshot)
      VALUES (${ctx.organizationId}, ${siteId}, ${briefId}, ${ownerId}, ${input.reviewerId}, ${JSON.stringify(input.snapshot)}::jsonb) RETURNING *`);
    await checkpoint(tx, ctx, doc, 'created');
    return load(tx, ctx, siteId, doc.id);
  });
}
async function saveCheckpoint(
  tx: Tx,
  ctx: RequestContext,
  doc: ContentDocument,
  snapshot: ContentSnapshot,
  reviewerId: string | null,
  reason: string,
) {
  const next = { ...doc, snapshot, version: doc.version + 1 };
  await tx.query(sql`UPDATE seo_content_documents SET snapshot = ${JSON.stringify(snapshot)}::jsonb, reviewer_id = ${reviewerId},
    version = ${next.version}, status = 'draft', approved_version = NULL, updated_at = now()
    WHERE organization_id = ${ctx.organizationId} AND id = ${doc.id}`);
  await tx.query(sql`UPDATE seo_content_briefs SET title = ${snapshot.title}, target_url = ${snapshot.targetUrl || null},
    intent = ${snapshot.purpose || null}, outline = ${JSON.stringify(
      snapshot.outline
        .split(/\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    )}::jsonb,
    target_audience = ${snapshot.audience}, requested_keywords = ${snapshot.keywords
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean)},
    source_notes = ${snapshot.sources}, meta_description = ${snapshot.metaDescription}, due_date = ${snapshot.dueDate || null}::date,
    status = 'draft', approved_by = NULL, approved_at = NULL, updated_at = now()
    WHERE organization_id = ${ctx.organizationId} AND id = (SELECT brief_id FROM seo_content_documents WHERE organization_id = ${ctx.organizationId} AND id = ${doc.id})`);
  await checkpoint(tx, ctx, next, reason);
}
export async function saveContent(
  ctx: RequestContext,
  siteId: string,
  id: string,
  input: z.infer<typeof contentSaveSchema>,
) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    const doc = await load(tx, ctx, siteId, id, true);
    requireEditor(ctx, doc);
    requireVersion(doc, input.expectedVersion);
    if (doc.status === 'archived')
      throw invalid('Reopen this archived document before editing.');
    await validateAssignment(tx, ctx, siteId, doc.ownerId, input.reviewerId);
    await validateBrand(tx, ctx, siteId, input.snapshot);
    if (
      (Object.keys(input.snapshot) as (keyof ContentSnapshot)[]).every(
        (key) => doc.snapshot[key] === input.snapshot[key],
      ) &&
      doc.reviewerId === input.reviewerId
    )
      return doc;
    await saveCheckpoint(tx, ctx, doc, input.snapshot, input.reviewerId, 'saved');
    return load(tx, ctx, siteId, id);
  });
}
/** Shared rich-text updates stay live without creating a numbered revision per keystroke. */
export async function saveContentBody(
  ctx: RequestContext,
  siteId: string,
  id: string,
  body: string,
) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    const doc = await load(tx, ctx, siteId, id, true);
    requireEditor(ctx, doc);
    if (doc.status === 'archived')
      throw invalid('Reopen this archived document before editing.');
    await tx.query(sql`UPDATE seo_content_documents
      SET snapshot = jsonb_set(snapshot, '{body}', to_jsonb(${body}::text), true), updated_at = now()
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
    return load(tx, ctx, siteId, id);
  });
}
export async function checkpointContent(
  ctx: RequestContext,
  siteId: string,
  id: string,
  expectedVersion: number,
) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    const doc = await load(tx, ctx, siteId, id, true);
    requireEditor(ctx, doc);
    requireVersion(doc, expectedVersion);
    if (doc.status === 'archived')
      throw invalid('Reopen this archived document before saving a revision.');
    const next = { ...doc, version: doc.version + 1 };
    await tx.query(sql`UPDATE seo_content_documents SET version = ${next.version}, updated_at = now()
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
    await checkpoint(tx, ctx, next, 'manual_checkpoint');
    return load(tx, ctx, siteId, id);
  });
}
export async function transitionContent(
  ctx: RequestContext,
  siteId: string,
  id: string,
  input: z.infer<typeof contentTransitionSchema>,
) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    const doc = await load(tx, ctx, siteId, id, true);
    requireVersion(doc, input.expectedVersion);
    const status = transitionStatus(
      doc,
      input,
      ctx.principal.id,
      globalAccess(ctx.principal),
    );
    if (input.transition === 'submit')
      await validateAssignment(tx, ctx, siteId, doc.ownerId, doc.reviewerId);
    // Workflow changes advance the revision too, invalidating any outstanding autosave.
    const version = doc.version + 1;
    await tx.query(sql`UPDATE seo_content_documents SET status = ${status}, version = ${version},
      approved_version = ${status === 'approved' ? version : null}, updated_at = now()
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
    await tx.query(sql`UPDATE seo_content_briefs SET status = ${status}, approved_by = ${status === 'approved' ? ctx.principal.id : null},
      approved_at = ${status === 'approved' ? new Date() : null}, updated_at = now()
      WHERE organization_id = ${ctx.organizationId} AND id = (SELECT brief_id FROM seo_content_documents WHERE organization_id = ${ctx.organizationId} AND id = ${id})`);
    await checkpoint(tx, ctx, { ...doc, version }, input.transition);
    if (input.note) await event(tx, ctx, { id, version }, 'review_note', input.note);
    return load(tx, ctx, siteId, id);
  });
}
export async function contentHistory(
  ctx: RequestContext,
  siteId: string,
  id: string,
  offset = 0,
) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    await load(tx, ctx, siteId, id);
    const versions =
      await tx.query<ContentVersion>(sql`SELECT v.*, u.full_name AS author_name FROM seo_content_versions v
      JOIN app_user u ON u.organization_id = v.organization_id AND u.id = v.author_id
      WHERE v.organization_id = ${ctx.organizationId} AND v.document_id = ${id} ORDER BY v.version DESC LIMIT 20 OFFSET ${offset}`);
    const events =
      await tx.query<ContentEvent>(sql`SELECT e.*, u.full_name AS actor_name FROM seo_content_events e
      JOIN app_user u ON u.organization_id = e.organization_id AND u.id = e.actor_id
      WHERE e.organization_id = ${ctx.organizationId} AND e.document_id = ${id}
      ORDER BY e.created_at DESC, e.id DESC LIMIT 100`);
    return { versions, events };
  });
}
export async function contentCommentThreads(
  ctx: RequestContext,
  siteId: string,
  documentId: string,
) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    await load(tx, ctx, siteId, documentId);
    return tx.query<ContentCommentThread>(sql`
      SELECT t.id, t.document_id, t.kind, t.anchor_from, t.anchor_to, t.quoted_text,
        t.body, t.suggested_text, t.status, t.created_by AS author_id,
        u.full_name AS author_name, t.created_at, t.updated_at
      FROM seo_content_comment_threads t
      JOIN app_user u ON u.organization_id = t.organization_id AND u.id = t.created_by
      WHERE t.organization_id = ${ctx.organizationId} AND t.document_id = ${documentId}
      ORDER BY t.created_at, t.id
    `);
  });
}
export async function createContentComment(
  ctx: RequestContext,
  siteId: string,
  documentId: string,
  input: z.infer<typeof contentCommentCreateSchema>,
) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    await load(tx, ctx, siteId, documentId);
    const id = randomUUID();
    await tx.query(sql`
      INSERT INTO seo_content_comment_threads (
        organization_id, id, document_id, created_by, kind, anchor_from, anchor_to,
        quoted_text, body, suggested_text
      ) VALUES (
        ${ctx.organizationId}, ${id}, ${documentId}, ${ctx.principal.id}, ${input.kind},
        ${input.anchorFrom}, ${input.anchorTo}, ${input.quotedText}, ${input.body},
        ${input.kind === 'suggestion' ? input.suggestedText!.trim() : null}
      )
    `);
    const thread = await tx.maybeOne<ContentCommentThread>(sql`
      SELECT t.id, t.document_id, t.kind, t.anchor_from, t.anchor_to, t.quoted_text,
        t.body, t.suggested_text, t.status, t.created_by AS author_id,
        u.full_name AS author_name, t.created_at, t.updated_at
      FROM seo_content_comment_threads t
      JOIN app_user u ON u.organization_id = t.organization_id AND u.id = t.created_by
      WHERE t.organization_id = ${ctx.organizationId} AND t.id = ${id}
    `);
    if (!thread) throw notFound();
    return thread;
  });
}
export async function updateContentCommentStatus(
  ctx: RequestContext,
  siteId: string,
  documentId: string,
  threadId: string,
  status: 'open' | 'resolved' | 'accepted' | 'rejected',
) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    const doc = await load(tx, ctx, siteId, documentId);
    const thread = await tx.maybeOne<{
      kind: 'comment' | 'suggestion';
      status: 'open' | 'resolved' | 'accepted' | 'rejected';
    }>(sql`
      SELECT kind, status FROM seo_content_comment_threads
      WHERE organization_id = ${ctx.organizationId} AND document_id = ${documentId} AND id = ${threadId}
      FOR UPDATE
    `);
    if (!thread) throw notFound();
    const allowed =
      thread.kind === 'comment'
        ? status === 'open' || status === 'resolved'
        : status === 'open' || status === 'accepted' || status === 'rejected';
    if (!allowed) throw invalid('Choose a status that matches this review note.');
    if (status === 'accepted') {
      const permission = await effectivePolicy(ctx, 'seo:edit-content');
      if (
        doc.status === 'archived' ||
        !(
          globalAccess(ctx.principal) ||
          (permission?.allowed === true && doc.ownerId === ctx.principal.id)
        )
      )
        throw new ApplicationError(
          'Only the assigned writer or an administrator can apply a content suggestion.',
          403,
          'CONTENT_EDIT_FORBIDDEN',
        );
    }
    await tx.query(sql`
      UPDATE seo_content_comment_threads SET status = ${status}, updated_at = now()
      WHERE organization_id = ${ctx.organizationId} AND document_id = ${documentId} AND id = ${threadId}
    `);
    const updated = await tx.maybeOne<ContentCommentThread>(sql`
      SELECT t.id, t.document_id, t.kind, t.anchor_from, t.anchor_to, t.quoted_text,
        t.body, t.suggested_text, t.status, t.created_by AS author_id,
        u.full_name AS author_name, t.created_at, t.updated_at
      FROM seo_content_comment_threads t
      JOIN app_user u ON u.organization_id = t.organization_id AND u.id = t.created_by
      WHERE t.organization_id = ${ctx.organizationId} AND t.id = ${threadId}
    `);
    if (!updated) throw notFound();
    return updated;
  });
}
export async function restoreContent(
  ctx: RequestContext,
  siteId: string,
  id: string,
  expectedVersion: number,
  version: number,
) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    const doc = await load(tx, ctx, siteId, id, true);
    requireEditor(ctx, doc);
    requireVersion(doc, expectedVersion);
    if (doc.status === 'archived')
      throw invalid('Reopen the document before restoring a revision.');
    const prior =
      await tx.maybeOne<ContentVersion>(sql`SELECT snapshot FROM seo_content_versions
      WHERE organization_id = ${ctx.organizationId} AND document_id = ${id} AND version = ${version}`);
    if (!prior) throw notFound();
    await saveCheckpoint(
      tx,
      ctx,
      doc,
      prior.snapshot,
      doc.reviewerId,
      `restored_version_${version}`,
    );
    return load(tx, ctx, siteId, id);
  });
}
export async function exportContent(ctx: RequestContext, siteId: string, id: string) {
  await requireContentSite(ctx, siteId);
  return db.transaction(ctx, async (tx) => {
    const doc = await load(tx, ctx, siteId, id);
    await event(tx, ctx, doc, 'exported');
    return {
      filename: `content-${doc.id}-v${doc.version}.txt`,
      text: `${doc.snapshot.title}\n\n${contentBodyToPlainText(doc.snapshot.body)}\n\n---\nMeta description: ${doc.snapshot.metaDescription}\nTarget URL: ${doc.snapshot.targetUrl}\nSources:\n${doc.snapshot.sources}\n\nSaved version ${doc.version} | ${doc.status}. Export does not publish this article.`,
    };
  });
}
export async function readContentBrand(
  ctx: RequestContext,
  siteId: string,
  version?: number,
): Promise<ContentBrand> {
  const site = await requireContentSite(ctx, siteId);
  const scopeId = site['clientId'] ?? siteId;
  const row = await db.maybeOne<{ version: number; guidance: string }>(
    ctx,
    sql`SELECT version, guidance FROM seo_content_brand_versions
    WHERE organization_id = ${ctx.organizationId} AND scope_id = ${scopeId} ${version ? sql`AND version = ${version}` : sql``}
    ORDER BY version DESC LIMIT 1`,
  );
  if (version && !row) throw notFound();
  return {
    version: row?.version ?? 0,
    guidance: row?.guidance ?? '',
    scope: site['clientId'] ? 'client' : 'website',
  };
}
export async function saveContentBrand(
  ctx: RequestContext,
  siteId: string,
  expectedVersion: number,
  guidance: string,
) {
  const site = await requireContentSite(ctx, siteId);
  const clientId = site['clientId'] as string | null;
  const scopeId = clientId ?? siteId;
  await db.transaction(ctx, async (tx) => {
    // All websites sharing one client serialize brand changes on the same key.
    await tx.query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.organizationId}:brand:${scopeId}`}, 0))`,
    );
    const latest = await tx.maybeOne<{
      version: number;
    }>(sql`SELECT version FROM seo_content_brand_versions
      WHERE organization_id = ${ctx.organizationId} AND scope_id = ${scopeId} ORDER BY version DESC LIMIT 1`);
    if ((latest?.version ?? 0) !== expectedVersion) throw conflict();
    await tx.query(sql`INSERT INTO seo_content_brand_versions (organization_id, scope_id, client_id, site_id, version, guidance, author_id)
      VALUES (${ctx.organizationId}, ${scopeId}, ${clientId}, ${clientId ? null : siteId}, ${expectedVersion + 1}, ${guidance}, ${ctx.principal.id})`);
  });
  return readContentBrand(ctx, siteId);
}
