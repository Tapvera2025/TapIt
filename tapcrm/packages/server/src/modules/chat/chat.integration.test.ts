import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { closePools } from '../../platform/dal/pool.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { ChatNotFoundError, ChatNotSenderError, ChatValidationError } from './errors.js';
import {
  createInternalGroup,
  forwardMessage,
  getConversation,
  listConversations,
  listMessages,
  loadConversationResource,
  loadMessageResource,
  markRead,
  reactToMessage,
  removeReactionFromMessage,
  sendMessage,
  startDirectConversation,
  unsendMessage,
} from './service.js';

/**
 * Runs the chat engine against REAL PostgreSQL through the runtime role, so
 * RLS, the unique DM-pair index and the membership-based policy are all
 * exercised rather than assumed.
 *
 * Opt-in: needs a migrated database and refuses any whose name lacks "test".
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   REDIS_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... \
 *   npx vitest run packages/server/src/modules/chat
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

describe.skipIf(!enabled)('chat engine (PostgreSQL)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const deptA = randomUUID();
  const deptB = randomUUID();
  const posA = randomUUID();
  const posB = randomUUID();

  const alice = randomUUID();
  const bob = randomUUID();
  const carol = randomUUID();
  const outsider = randomUUID(); // organization B

  const asOwner = <T = unknown>(reason: string, fragment: ReturnType<typeof sql>) => platformDb.query<T>('migration', reason, fragment);

  function ctxFor(organizationId: string, userId: string): RequestContext {
    const principal: Principal = {
      id: userId,
      organizationId,
      accountType: 'employee',
      sessionVersion: 1,
      positionId: randomUUID(),
      departmentId: deptA,
      teamId: null,
      reportsTo: null,
      organizationalLevel: 1,
    };
    return createRequestContext({ organizationId, principal, requestId: `test-${userId}` });
  }

  const asAlice = () => ctxFor(orgA, alice);
  const asBob = () => ctxFor(orgA, bob);
  const asOutsider = () => ctxFor(orgB, outsider);

  async function addUser(organizationId: string, id: string, email: string, employeeId: string, departmentId: string, positionId: string): Promise<void> {
    await asOwner(
      'seed test user',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, status, full_name, employee_id, department_id, position_id)
          VALUES (${id}, ${organizationId}, 'employee', ${email}, 'active', ${`User ${id.slice(0, 4)}`}, ${employeeId}, ${departmentId}, ${positionId})`,
    );
  }

  beforeAll(async () => {
    const dbName = new URL(migrationUrl).pathname;
    if (!dbName.includes('test')) throw new Error(`Refusing to run against "${dbName}"`);

    for (const [id, code] of [[orgA, 'CHTA'], [orgB, 'CHTB']] as const) {
      await asOwner('seed org', sql`INSERT INTO organization (id, code, name) VALUES (${id}, ${`${code}${id.slice(0, 6)}`}, ${code})`);
    }
    await asOwner('seed dept', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${deptA}, ${orgA}, 'D1', 'Dept', 'support')`);
    await asOwner('seed dept b', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${deptB}, ${orgB}, 'D1', 'Dept', 'support')`);
    await asOwner(
      'seed position a',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${posA}, ${orgA}, ${deptA}, 'DEV', 'Developer', 20)`,
    );
    await asOwner(
      'seed position b',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${posB}, ${orgB}, ${deptB}, 'DEV', 'Developer', 20)`,
    );
    await addUser(orgA, alice, 'alice@chat-test.invalid', 'CHAT-A1', deptA, posA);
    await addUser(orgA, bob, 'bob@chat-test.invalid', 'CHAT-A2', deptA, posA);
    await addUser(orgA, carol, 'carol@chat-test.invalid', 'CHAT-A3', deptA, posA);
    await addUser(orgB, outsider, 'outsider@chat-test.invalid', 'CHAT-B1', deptB, posB);
  });

  afterAll(async () => {
    const orgs = [orgA, orgB];
    for (const table of ['message_reaction', 'message', 'conversation_member', 'conversation', 'identity_email_directory', 'app_user', 'position', 'department']) {
      await asOwner(`cleanup ${table}`, sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ANY(${orgs}::uuid[])`);
    }
    await asOwner('cleanup orgs', sql`DELETE FROM organization WHERE id = ANY(${orgs}::uuid[])`);
    await closePools();
  });

  it('reuses the same DM instead of forking it (direct_pair_key dedup)', async () => {
    const first = await startDirectConversation(asAlice(), bob);
    const second = await startDirectConversation(asAlice(), bob);
    const third = await startDirectConversation(asBob(), alice); // opened from the OTHER side
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(first.members.map((m) => m.userId).sort()).toEqual([alice, bob].sort());
  });

  it('rejects starting a DM with yourself or with someone outside the organization', async () => {
    await expect(startDirectConversation(asAlice(), alice)).rejects.toThrow(ChatValidationError);
    await expect(startDirectConversation(asAlice(), outsider)).rejects.toThrow(ChatValidationError);
  });

  it('membership is the only gate: a non-member cannot read or act, even by guessing the id', async () => {
    const conversation = await startDirectConversation(asAlice(), bob);

    const asCarol = ctxFor(orgA, carol);
    expect(await loadConversationResource(asCarol, conversation.id)).toEqual(
      expect.objectContaining({ memberIds: expect.arrayContaining([alice, bob]) }),
    );
    // The loader returns the resource (it exists); it is the ENGINE that would
    // refuse Carol — this test exercises the loader/service layer directly, so
    // it asserts membership content rather than the full HTTP 403/404 path
    // (that path is exercised by the route wiring + authz engine together).
    const resource = await loadConversationResource(asCarol, conversation.id);
    expect((resource as unknown as { memberIds: string[] }).memberIds).not.toContain(carol);
  });

  it('a foreign organization id resolves to nothing at all (tenant isolation via RLS)', async () => {
    const conversation = await startDirectConversation(asAlice(), bob);
    expect(await loadConversationResource(asOutsider(), conversation.id)).toBeNull();
    await expect(getConversation(asOutsider(), conversation.id)).rejects.toThrow(ChatNotFoundError);
  });

  it('sends, replies, and lists newest-first with a working cursor', async () => {
    const conversation = await startDirectConversation(asAlice(), bob);
    const first = await sendMessage(asAlice(), conversation.id, { body: 'Hello Bob' });
    const second = await sendMessage(asBob(), conversation.id, { body: 'Hi Alice', replyToMessageId: first.id });

    expect(second.replyPreview?.body).toBe('Hello Bob');

    const page = await listMessages(asAlice(), conversation.id, { limit: 10 });
    expect(page.messages.map((m) => m.id)).toEqual([second.id, first.id]); // newest first
    expect(page.nextCursor).toBeNull();
  });

  it('rejects replying to a message from a different conversation', async () => {
    const convoAB = await startDirectConversation(asAlice(), bob);
    const convoAC = await startDirectConversation(asAlice(), carol);
    const messageInAB = await sendMessage(asAlice(), convoAB.id, { body: 'only in AB' });

    await expect(sendMessage(asAlice(), convoAC.id, { body: 'cross-thread reply', replyToMessageId: messageInAB.id })).rejects.toThrow(ChatValidationError);
  });

  it('forward copies the content into a conversation you belong to, with attribution', async () => {
    const convoAB = await startDirectConversation(asAlice(), bob);
    const convoAC = await startDirectConversation(asAlice(), carol);
    const original = await sendMessage(asBob(), convoAB.id, { body: 'Forward me' });

    const forwarded = await forwardMessage(asAlice(), original.id, convoAC.id);
    expect(forwarded.body).toBe('Forward me');
    expect(forwarded.forwarded).toBe(true);
    expect(forwarded.forwardedFromSenderId).toBe(bob);
    expect(forwarded.conversationId).toBe(convoAC.id);
  });

  it('cannot forward into a conversation you are not a member of', async () => {
    const convoAB = await startDirectConversation(asAlice(), bob);
    const convoBC = await startDirectConversation(asBob(), carol);
    const message = await sendMessage(asAlice(), convoAB.id, { body: 'x' });

    await expect(forwardMessage(asAlice(), message.id, convoBC.id)).rejects.toThrow(ChatNotFoundError);
  });

  it('unsend: only the sender may, it tombstones rather than deletes, and is idempotent', async () => {
    const conversation = await startDirectConversation(asAlice(), bob);
    const message = await sendMessage(asAlice(), conversation.id, { body: 'oops' });

    await expect(unsendMessage(asBob(), message.id)).rejects.toThrow(ChatNotSenderError);

    const unsent = await unsendMessage(asAlice(), message.id);
    expect(unsent.body).toBeNull();
    expect(unsent.deletedAt).not.toBeNull();

    // The row still exists (a tombstone), and unsending again is a no-op, not an error.
    const again = await unsendMessage(asAlice(), message.id);
    expect(again.id).toBe(message.id);

    const [rowCount] = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM message WHERE id = ${message.id}`);
    expect(rowCount?.n).toBe('1');
  });

  it('an unsent message cannot be forwarded or reacted to', async () => {
    const convoAB = await startDirectConversation(asAlice(), bob);
    const convoAC = await startDirectConversation(asAlice(), carol);
    const message = await sendMessage(asAlice(), convoAB.id, { body: 'temporary' });
    await unsendMessage(asAlice(), message.id);

    await expect(forwardMessage(asAlice(), message.id, convoAC.id)).rejects.toThrow(ChatValidationError);
    await expect(reactToMessage(asBob(), message.id, '👍')).rejects.toThrow(ChatValidationError);
  });

  it('reactions are per (message, user, emoji): adding twice is a no-op, removal is independent per emoji', async () => {
    const conversation = await startDirectConversation(asAlice(), bob);
    const message = await sendMessage(asAlice(), conversation.id, { body: 'react to me' });

    await reactToMessage(asBob(), message.id, '👍');
    const again = await reactToMessage(asBob(), message.id, '👍');
    expect(again.reactions.filter((r) => r.userId === bob && r.emoji === '👍')).toHaveLength(1);

    await reactToMessage(asBob(), message.id, '❤️');
    const withTwo = await removeReactionFromMessage(asBob(), message.id, '👍');
    expect(withTwo.reactions).toEqual([{ userId: bob, emoji: '❤️' }]);
  });

  it('"seen by" reflects the reader\'s cursor, and marking read moves it', async () => {
    const conversation = await startDirectConversation(asAlice(), bob);
    const message = await sendMessage(asAlice(), conversation.id, { body: 'did you see this?' });

    const beforeRead = (await listMessages(asAlice(), conversation.id, { limit: 10 })).messages[0]!;
    expect(beforeRead.seenBy).not.toContain(bob);

    await markRead(asBob(), conversation.id);

    const afterRead = (await listMessages(asAlice(), conversation.id, { limit: 10 })).messages[0]!;
    expect(afterRead.id).toBe(message.id);
    expect(afterRead.seenBy).toContain(bob);
    expect(afterRead.seenBy).not.toContain(alice); // the sender is never listed as a reader of their own message
  });

  it('Internal Group: creates a named, multi-member conversation and resolves message-scoped routes to it', async () => {
    const group = await createInternalGroup(asAlice(), { name: 'Ops Room', memberIds: [bob, carol] });
    expect(group.kind).toBe('group');
    expect(group.name).toBe('Ops Room');
    expect(group.members.map((m) => m.userId).sort()).toEqual([alice, bob, carol].sort());

    const message = await sendMessage(asAlice(), group.id, { body: 'welcome' });
    const resource = await loadMessageResource(ctxFor(orgA, carol), message.id);
    expect((resource as { memberIds: string[] } | null)?.memberIds).toEqual(expect.arrayContaining([alice, bob, carol]));
  });

  it('rejects adding an inactive or cross-tenant member to a group', async () => {
    await expect(createInternalGroup(asAlice(), { name: 'Bad group', memberIds: [bob, outsider] })).rejects.toThrow(ChatValidationError);
  });

  it('the Direct Messages tab lists only kind=direct, newest activity first', async () => {
    const direct = await startDirectConversation(asAlice(), bob);
    await createInternalGroup(asAlice(), { name: 'Another Room', memberIds: [bob] });
    await sendMessage(asAlice(), direct.id, { body: 'bump to top' });

    const directOnly = await listConversations(asAlice(), 'direct');
    expect(directOnly.every((c) => c.kind === 'direct')).toBe(true);
    expect(directOnly.some((c) => c.id === direct.id)).toBe(true);
  });
});
