import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql, type SqlQuery } from '../../platform/dal/sql.js';
import { decodeMessageCursor, encodeMessageCursor } from './repository.js';
import type { AttachmentKind, ConversationKind, SearchResult } from './types.js';

/**
 * Full-text message search (0134) — PostgreSQL `tsvector` + GIN.
 *
 * Reads only what the person may read today: messages of conversations they
 * are a CURRENT member of, not archived, not unsent. Results are newest
 * first with a keyset cursor, so paging is stable while new messages arrive.
 *
 * The query matches two ways, OR-ed:
 *   websearch_to_tsquery('english', q)  stemmed words, "quoted phrases", -exclusions
 *   to_tsquery('simple', 'w1:* & w2:*') every word as a PREFIX, so results appear
 *                                       while typing and names/codes match verbatim
 * Attachment file names are searched with the same query.
 */

export type SearchType = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'file' | 'link';

export interface SearchInput {
  readonly q?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly senderId?: string | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly type?: SearchType | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

const MAX_TERMS = 8;

/**
 * The words of a query, for the prefix half: letters and digits in any
 * script, with their combining marks (Devanagari vowel signs and virama are
 * marks — without them "नमस्ते" would split into fragments PostgreSQL's
 * parser never produces).
 */
export function searchTerms(q: string | undefined): string[] {
  if (!q) return [];
  const words = q.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];
  return [...new Set(words.map((term) => term.slice(0, 64)))].slice(0, MAX_TERMS);
}

/** `to_tsquery` text built only from letter/digit/mark runs, so it can never be a syntax error or an injection. */
export function prefixQuery(terms: readonly string[]): string {
  return terms.map((term) => `${term}:*`).join(' & ');
}

const KINDS: readonly AttachmentKind[] = ['image', 'pdf', 'document', 'spreadsheet', 'presentation'];

function typeFilter(type: SearchType | undefined): SqlQuery {
  if (!type) return sql``;
  if (type === 'link') {
    return sql`AND EXISTS (SELECT 1 FROM message_link ml WHERE ml.organization_id = m.organization_id AND ml.message_id = m.id)`;
  }
  if (type === 'file') {
    return sql`AND EXISTS (SELECT 1 FROM message_attachment fa WHERE fa.organization_id = m.organization_id AND fa.message_id = m.id)`;
  }
  if (!KINDS.includes(type)) return sql``;
  return sql`AND EXISTS (SELECT 1 FROM message_attachment fa WHERE fa.organization_id = m.organization_id AND fa.message_id = m.id AND fa.kind = ${type})`;
}

interface ResultRow {
  id: string;
  conversationId: string;
  conversationKind: ConversationKind;
  conversationName: string | null;
  otherMemberName: string | null;
  senderId: string;
  senderName: string;
  createdAt: Date;
  editedAt: Date | null;
  snippet: string | null;
}

export async function searchMessages(ctx: RequestContext, input: SearchInput): Promise<{ results: SearchResult[]; nextCursor: string | null }> {
  const terms = searchTerms(input.q);
  const text = (input.q ?? '').trim().slice(0, 200);
  const hasQuery = terms.length > 0;
  const cursor = input.cursor ? decodeMessageCursor(input.cursor) : null;
  const cursorAt = cursor?.createdAt ?? null;
  const cursorId = cursor?.id ?? null;
  // An empty query is allowed only with a filter ("every PDF in this group").
  const query = hasQuery
    ? sql`(websearch_to_tsquery('english', ${text}) || to_tsquery('simple', ${prefixQuery(terms)}))`
    : sql`NULL::tsquery`;

  const rows = await db.query<ResultRow>(ctx, sql`
    WITH q AS (SELECT ${query} AS query)
    SELECT m.id, m.conversation_id AS "conversationId", c.kind AS "conversationKind", c.name AS "conversationName",
           CASE WHEN c.kind = 'direct' THEN (
             SELECT ou.full_name FROM conversation_member ocm
             JOIN app_user ou ON ou.organization_id = ocm.organization_id AND ou.id = ocm.user_id
             WHERE ocm.organization_id = c.organization_id AND ocm.conversation_id = c.id AND ocm.user_id <> ${ctx.principal.id}
             LIMIT 1
           ) END AS "otherMemberName",
           m.sender_id AS "senderId", su.full_name AS "senderName", m.created_at AS "createdAt", m.edited_at AS "editedAt",
           CASE WHEN ${hasQuery}::boolean
             THEN ts_headline('english', coalesce(m.body, ''), q.query,
                    'StartSel=⟦, StopSel=⟧, MaxWords=30, MinWords=10, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "')
             ELSE left(coalesce(m.body, ''), 240)
           END AS snippet
      FROM message m
      CROSS JOIN q
      JOIN conversation c ON c.organization_id = m.organization_id AND c.id = m.conversation_id AND c.archived_at IS NULL
      JOIN conversation_member cm ON cm.organization_id = c.organization_id AND cm.conversation_id = c.id
       AND cm.user_id = ${ctx.principal.id} AND cm.left_at IS NULL
      JOIN app_user su ON su.organization_id = m.organization_id AND su.id = m.sender_id
     WHERE m.organization_id = ${ctx.organizationId}
       AND m.deleted_at IS NULL
       AND (NOT ${hasQuery}::boolean
            OR m.search_vector @@ q.query
            OR EXISTS (
              SELECT 1 FROM message_attachment qa
               WHERE qa.organization_id = m.organization_id AND qa.message_id = m.id AND qa.search_vector @@ q.query
            ))
       AND (${input.conversationId ?? null}::uuid IS NULL OR m.conversation_id = ${input.conversationId ?? null}::uuid)
       AND (${input.senderId ?? null}::uuid IS NULL OR m.sender_id = ${input.senderId ?? null}::uuid)
       AND (${input.from ?? null}::timestamptz IS NULL OR m.created_at >= ${input.from ?? null}::timestamptz)
       AND (${input.to ?? null}::timestamptz IS NULL OR m.created_at < ${input.to ?? null}::timestamptz)
       ${typeFilter(input.type)}
       AND (${cursorAt}::timestamptz IS NULL OR (m.created_at, m.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid))
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT ${input.limit + 1}
  `);

  const page = rows.slice(0, input.limit);
  const ids = page.map((row) => row.id);
  const [files, links] = ids.length === 0
    ? [[], []]
    : await Promise.all([
        db.query<{ messageId: string; id: string; kind: AttachmentKind; fileName: string }>(ctx, sql`
          SELECT message_id AS "messageId", id, kind, file_name AS "fileName" FROM message_attachment
           WHERE organization_id = ${ctx.organizationId} AND message_id = ANY(${ids}::uuid[])
           ORDER BY message_id, position
        `),
        db.query<{ messageId: string }>(ctx, sql`
          SELECT DISTINCT message_id AS "messageId" FROM message_link
           WHERE organization_id = ${ctx.organizationId} AND message_id = ANY(${ids}::uuid[])
        `),
      ]);
  const withLinks = new Set(links.map((row) => row.messageId));

  const results: SearchResult[] = page.map((row) => ({
    messageId: row.id,
    conversationId: row.conversationId,
    conversationKind: row.conversationKind,
    conversationLabel: row.conversationKind === 'direct' ? (row.otherMemberName ?? 'Direct message') : (row.conversationName ?? 'Group'),
    senderId: row.senderId,
    senderName: row.senderName,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    snippet: row.snippet ?? '',
    attachments: files.filter((file) => file.messageId === row.id).map(({ id, kind, fileName }) => ({ id, kind, fileName })),
    hasLinks: withLinks.has(row.id),
  }));
  const last = page[page.length - 1];
  return {
    results,
    nextCursor: rows.length > input.limit && last ? encodeMessageCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}
