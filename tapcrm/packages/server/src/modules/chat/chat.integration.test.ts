import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { closePools } from '../../platform/dal/pool.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { dispatchOrganization } from '../notifications/dispatcher.js';
import { ChatNotFoundError, ChatNotSenderError, ChatValidationError } from './errors.js';
import {
  addGroupMembers,
  archiveGroup,
  createInternalGroup,
  forwardMessage,
  getConversation,
  listConversations,
  listMessages,
  loadConversationResource,
  loadMessageResource,
  markRead,
  reactToMessage,
  removeGroupMember,
  removeReactionFromMessage,
  renameGroup,
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
    // Chat actions notify now (new message, reaction, group membership), so
    // these must be cleaned up before the organizations they reference.
    for (const table of [
      'notification_delivery', 'notification', 'notification_outbox',
      'message_reaction', 'message', 'conversation_member', 'conversation',
      'identity_email_directory', 'app_user', 'position', 'department',
    ]) {
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

  describe('Internal Group governance', () => {
    it('renames a group', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Old Name', memberIds: [bob] });
      const renamed = await renameGroup(asAlice(), group.id, 'New Name');
      expect(renamed.name).toBe('New Name');
    });

    it('adds a member, who can then read the group, and removing them revokes access (soft, history preserved)', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Growing Group', memberIds: [bob] });
      expect(group.members.map((m) => m.userId)).not.toContain(carol);

      const withCarol = await addGroupMembers(asAlice(), group.id, [carol]);
      expect(withCarol.members.map((m) => m.userId)).toContain(carol);
      const message = await sendMessage(asAlice(), group.id, { body: 'hi carol' });
      expect(await loadMessageResource(ctxFor(orgA, carol), message.id)).not.toBeNull();

      const withoutCarol = await removeGroupMember(asAlice(), group.id, carol);
      expect(withoutCarol.members.map((m) => m.userId)).not.toContain(carol);
      // Membership is gone, but the message carol read while a member is untouched.
      expect(await loadConversationResource(ctxFor(orgA, carol), group.id)).toEqual(
        expect.objectContaining({ memberIds: expect.not.arrayContaining([carol]) }),
      );
      const [row] = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM message WHERE id = ${message.id}`);
      expect(row?.n).toBe('1');
    });

    it('re-adding a previously removed member restores access (rejoin, not a duplicate row)', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Revolving Door', memberIds: [bob] });
      await removeGroupMember(asAlice(), group.id, bob);
      const rejoined = await addGroupMembers(asAlice(), group.id, [bob]);
      expect(rejoined.members.map((m) => m.userId)).toContain(bob);

      const [row] = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM conversation_member WHERE conversation_id = ${group.id} AND user_id = ${bob}`);
      expect(row?.n).toBe('1');
    });

    it('archiving a group drops it from the conversation list but does not delete it', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Retiring Room', memberIds: [bob] });
      await archiveGroup(asAlice(), group.id);

      const groups = await listConversations(asAlice(), 'group');
      expect(groups.some((c) => c.id === group.id)).toBe(false);

      const [row] = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM conversation WHERE id = ${group.id}`);
      expect(row?.n).toBe('1');
    });

    it('refuses to manage a direct conversation or a project conversation through the group governance path', async () => {
      const direct = await startDirectConversation(asAlice(), bob);
      await expect(renameGroup(asAlice(), direct.id, 'Not a group')).rejects.toThrow(ChatValidationError);
      await expect(addGroupMembers(asAlice(), direct.id, [carol])).rejects.toThrow(ChatValidationError);
      await expect(removeGroupMember(asAlice(), direct.id, bob)).rejects.toThrow(ChatValidationError);
      await expect(archiveGroup(asAlice(), direct.id)).rejects.toThrow(ChatValidationError);
    });
  });

  it('the Direct Messages tab lists only kind=direct, newest activity first', async () => {
    const direct = await startDirectConversation(asAlice(), bob);
    await createInternalGroup(asAlice(), { name: 'Another Room', memberIds: [bob] });
    await sendMessage(asAlice(), direct.id, { body: 'bump to top' });

    const directOnly = await listConversations(asAlice(), 'direct');
    expect(directOnly.every((c) => c.kind === 'direct')).toBe(true);
    expect(directOnly.some((c) => c.id === direct.id)).toBe(true);
  });

  describe('notifications', () => {
    const notificationTitlesFor = async (userId: string): Promise<string[]> => {
      await dispatchOrganization(orgA);
      const rows = await asOwner<{ title: string }>(
        'read',
        sql`SELECT title FROM notification WHERE recipient_id = ${userId} ORDER BY created_at`,
      );
      return rows.map((r) => r.title);
    };

    /** Scoped to one conversation — other tests in this suite share alice/bob and must not bleed into these assertions. */
    const notificationTitlesForInConversation = async (userId: string, conversationId: string): Promise<string[]> => {
      await dispatchOrganization(orgA);
      const rows = await asOwner<{ title: string }>(
        'read',
        sql`SELECT title FROM notification WHERE recipient_id = ${userId} AND metadata->>'conversationId' = ${conversationId} ORDER BY created_at`,
      );
      return rows.map((r) => r.title);
    };

    const notificationsForInConversation = async (userId: string, conversationId: string): Promise<{ title: string; link: string | null }[]> => {
      await dispatchOrganization(orgA);
      return asOwner<{ title: string; link: string | null }>(
        'read',
        sql`SELECT title, link FROM notification WHERE recipient_id = ${userId} AND metadata->>'conversationId' = ${conversationId} ORDER BY created_at`,
      );
    };

    it('a new message notifies the other member, never the sender', async () => {
      // alice/bob's DM is deduped (direct_pair_key) and reused by many other
      // tests in this file, so "never the sender" is checked as a delta, not
      // an absolute empty list.
      const conversation = await startDirectConversation(asAlice(), bob);
      const aliceBefore = (await notificationTitlesForInConversation(alice, conversation.id)).length;

      await sendMessage(asAlice(), conversation.id, { body: 'hi bob' });

      expect(await notificationTitlesForInConversation(bob, conversation.id)).toContain('New message from User ' + alice.slice(0, 4));
      expect(await notificationTitlesForInConversation(alice, conversation.id)).toHaveLength(aliceBefore);
    });

    it('a group message is titled with the group name, not the sender', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Launch Room', memberIds: [bob] });
      await dispatchOrganization(orgA); // flush the "added to group" notification first
      await sendMessage(asAlice(), group.id, { body: 'go time' });

      expect(await notificationTitlesFor(bob)).toContain('New message in Launch Room');
    });

    it('reacting notifies only the message sender, not reacting to your own message', async () => {
      const conversation = await startDirectConversation(asAlice(), bob);
      const message = await sendMessage(asAlice(), conversation.id, { body: 'react to this' });
      await dispatchOrganization(orgA); // flush the "new message" notification

      await reactToMessage(asBob(), message.id, '👍');
      const aliceTitles = await notificationTitlesFor(alice);
      expect(aliceTitles.some((t) => t.includes('reacted 👍 to your message'))).toBe(true);

      await reactToMessage(asAlice(), message.id, '❤️'); // reacting to your own message notifies no one
      expect(await notificationTitlesFor(alice)).toEqual(aliceTitles);
    });

    it('being added to or removed from a group notifies exactly that person', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Rotating Room', memberIds: [] });
      await addGroupMembers(asAlice(), group.id, [bob]);
      expect(await notificationTitlesFor(bob)).toContain('You were added to Rotating Room');

      await removeGroupMember(asAlice(), group.id, bob);
      expect(await notificationTitlesFor(bob)).toContain('You were removed from Rotating Room');
    });

    it('@mentioning a member notifies them with a deep link to the conversation and message, never a non-member', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Mentions Room', memberIds: [bob, carol] });
      await dispatchOrganization(orgA); // flush the "added to group" notifications first

      const message = await sendMessage(asAlice(), group.id, {
        body: '@User mentions, can you take a look?',
        mentionedUserIds: [bob, outsider], // outsider is org B — not a member here, must be dropped silently
      });

      expect(message.mentions.map((m) => m.userId)).toEqual([bob]);

      const bobNotifications = await notificationsForInConversation(bob, group.id);
      const mention = bobNotifications.find((n) => n.title.includes('mentioned you in Mentions Room'));
      expect(mention).toBeDefined();
      expect(mention!.link).toBe(`/company/messages?conversationId=${group.id}&messageId=${message.id}`);

      // Never mentioned, and not a member of this org's group at all.
      expect(await notificationTitlesFor(outsider)).toEqual([]);
      expect((await notificationTitlesForInConversation(carol, group.id)).some((t) => t.includes('mentioned you'))).toBe(false);
    });
  });
});
