import { Server as HocuspocusServer } from '@hocuspocus/server';
import { TiptapTransformer } from '@hocuspocus/transformer';
import StarterKit from '@tiptap/starter-kit';
import * as Y from 'yjs';
import { createRequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { loadConfig } from '../../config.js';
import { resolvePrincipalFromToken } from '../identity/facade.js';
import { contentCollaborationAccess } from './content-service.js';
import { plainTextToContentJson } from '@tapcrm/contracts';

interface CollaborationContext {
  readonly token: string;
  readonly organizationId: string;
  readonly documentId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly editable: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTENSIONS = [StarterKit];
let server: HocuspocusServer<CollaborationContext> | null = null;

function requestId(documentId: string, userId: string) {
  return `content-collab:${documentId}:${userId}`;
}

async function authorize(token: string, documentName: string) {
  if (!UUID.test(documentName)) throw new Error('CONTENT_NOT_FOUND');
  const identity = await resolvePrincipalFromToken(token, { touch: false });
  if (identity.expiresAt.getTime() <= Date.now()) throw new Error('UNAUTHENTICATED');
  const ctx = createRequestContext({
    organizationId: identity.organizationId,
    principal: identity.principal,
    requestId: requestId(documentName, identity.principal.id),
  });
  const access = await contentCollaborationAccess(ctx, documentName);
  const context: CollaborationContext = {
    token,
    organizationId: access.organizationId,
    documentId: access.documentId,
    userId: access.userId,
    displayName: access.displayName,
    editable: access.editable,
  };
  return { ctx, access, context };
}

function originAllowed(origin: string | null, allowed: readonly string[]) {
  // Native clients may omit Origin; they still must present a current CRM token.
  if (origin === null) return true;
  return allowed.includes(origin);
}

function parseContext(value: unknown): CollaborationContext {
  if (
    !value ||
    typeof value !== 'object' ||
    !('token' in value) ||
    !('documentId' in value) ||
    typeof value.token !== 'string' ||
    typeof value.documentId !== 'string'
  ) {
    throw new Error('UNAUTHENTICATED');
  }
  return value as CollaborationContext;
}

export async function startContentCollaboration() {
  if (server) return;
  const config = loadConfig();
  const origins = [
    ...new Set(
      [config.CLIENT_ORIGIN, ...config.CORS_ORIGIN.split(',')]
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  const instance = new HocuspocusServer<CollaborationContext>({
    name: 'tapcrm-content-collaboration',
    port: config.CONTENT_COLLAB_PORT,
    address: '0.0.0.0',
    quiet: true,
    debounce: 900,
    maxDebounce: 2500,
    websocketOptions: { maxPayload: 1024 * 1024 },
    async onConnect({ requestHeaders }) {
      if (!originAllowed(requestHeaders.get('origin'), origins))
        throw new Error('ORIGIN_NOT_ALLOWED');
    },
    async onAuthenticate({ token, documentName }) {
      const { context } = await authorize(token, documentName);
      return context;
    },
    async onLoadDocument({ context, documentName }) {
      const authenticated = parseContext(context);
      if (authenticated.documentId !== documentName) throw new Error('CONTENT_NOT_FOUND');
      const { ctx } = await authorize(authenticated.token, documentName);
      if (ctx.organizationId !== authenticated.organizationId)
        throw new Error('CONTENT_NOT_FOUND');
      const stored = await db.maybeOne<{ state: Buffer }>(
        ctx,
        sql`
        SELECT y_state AS state FROM seo_content_collaboration_state
        WHERE organization_id = ${ctx.organizationId} AND document_id = ${documentName}
      `,
      );
      if (stored) return new Uint8Array(stored.state);
      const doc = await db.maybeOne<{ snapshot: { body: string } }>(
        ctx,
        sql`
        SELECT snapshot FROM seo_content_documents
        WHERE organization_id = ${ctx.organizationId} AND id = ${documentName}
      `,
      );
      if (!doc) throw new Error('CONTENT_NOT_FOUND');
      const initial = TiptapTransformer.toYdoc(
        plainTextToContentJson(doc.snapshot.body),
        'default',
        EXTENSIONS,
      );
      return Y.encodeStateAsUpdate(initial);
    },
    async beforeHandleMessage({ context, documentName, connection }) {
      const previous = parseContext(context);
      const { context: current } = await authorize(previous.token, documentName);
      if (
        current.organizationId !== previous.organizationId ||
        current.userId !== previous.userId
      )
        throw new Error('UNAUTHENTICATED');
      connection.readOnly = !current.editable;
    },
    async beforeHandleAwareness({ context, documentName, states }) {
      const previous = parseContext(context);
      const { context: current } = await authorize(previous.token, documentName);
      if (
        current.organizationId !== previous.organizationId ||
        current.userId !== previous.userId
      )
        throw new Error('UNAUTHENTICATED');
      // Awareness labels are sourced from the authenticated CRM identity.
      for (const state of states.values()) {
        state['user'] = {
          id: current.userId,
          name: current.displayName,
          color: `#${current.userId.replace(/-/g, '').slice(0, 6)}`,
        };
      }
    },
    async onStoreDocument({ document, documentName, lastContext }) {
      const previous = parseContext(lastContext);
      const { ctx, context } = await authorize(previous.token, documentName);
      if (
        context.organizationId !== previous.organizationId ||
        context.userId !== previous.userId ||
        !context.editable
      )
        throw new Error('CONTENT_EDIT_FORBIDDEN');
      const state = Buffer.from(Y.encodeStateAsUpdate(document));
      const body = JSON.stringify(TiptapTransformer.fromYdoc(document, 'default'));
      await db.transaction(ctx, async (tx) => {
        await tx.query(sql`
        INSERT INTO seo_content_collaboration_state (organization_id, document_id, y_state)
        VALUES (${ctx.organizationId}, ${documentName}, ${state})
        ON CONFLICT (organization_id, document_id)
        DO UPDATE SET y_state = EXCLUDED.y_state, updated_at = now()
      `);
        await tx.query(sql`
        UPDATE seo_content_documents
        SET snapshot = jsonb_set(snapshot, '{body}', to_jsonb(${body}::text), true), updated_at = now()
        WHERE organization_id = ${ctx.organizationId} AND id = ${documentName}
      `);
      });
    },
  });
  await instance.listen();
  server = instance;
}

export async function stopContentCollaboration() {
  const current = server;
  server = null;
  if (current) await current.destroy();
}
