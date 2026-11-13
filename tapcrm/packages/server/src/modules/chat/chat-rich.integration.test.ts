import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { __resetConfig } from '../../config.js';
import { closePools } from '../../platform/dal/pool.js';
import { createJobContext, createRequestContext, systemPrincipal, type RequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { OPERATIONAL_TZ } from '../../platform/time.js';
import { dispatchOrganization } from '../notifications/facade.js';
import { cleanupPendingAttachments, deletePendingAttachment, uploadAttachment } from './attachments.js';
import { ChatEditWindowClosedError, ChatNotSenderError, ChatValidationError } from './errors.js';
import { buildChatFileRouter } from './file-routes.js';
import { localChatPath } from './file-storage.js';
import { refreshLinkPreviews } from './link-preview.js';
import { presenceForColleagues } from './presence.js';
import { cancelScheduled, listScheduled, scheduleMessage, sendDueScheduledMessages, sendScheduledNow, updateScheduled } from './scheduled.js';
import { searchMessages } from './search.js';
import {
  addGroupMembers,
  createInternalGroup,
  editMessage,
  forwardMessage,
  getConversation,
  getMessage,
  getMessageEdits,
  listMessages,
  listPins,
  listSaved,
  pinMessage,
  reactToMessage,
  removeGroupMember,
  removeReactionFromMessage,
  saveMessage,
  sendMessage,
  startDirectConversation,
  unpinMessage,
  unsaveMessage,
  unsendMessage,
} from './service.js';
import { reactionSchema } from './validators.js';

/**
 * Rich messaging (0133–0140) against REAL PostgreSQL through the runtime
 * role: attachments, search, editing, link previews, pins, any-emoji
 * reactions, saved messages, scheduled sending and presence.
 *
 * Opt-in like the other integration suites:
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   REDIS_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... \
 *   npx vitest run packages/server/src/modules/chat
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

const uploadDir = mkdtempSync(join(tmpdir(), 'tapcrm-chat-'));

describe.skipIf(!enabled)('chat rich messaging (PostgreSQL)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const deptA = randomUUID();
  const deptB = randomUUID();
  const posA = randomUUID();
  const posB = randomUUID();
  const alice = randomUUID();
  const bob = randomUUID();
  const carol = randomUUID();
  const outsider = randomUUID();
  let ogServer: Server;
  let ogBase = '';

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
  const asCarol = () => ctxFor(orgA, carol);
  const jobCtx = () => createJobContext({ organizationId: orgA, principal: systemPrincipal(orgA), jobName: 'test', runId: randomUUID() });

  async function addUser(organizationId: string, id: string, name: string, email: string, employeeId: string, departmentId: string, positionId: string): Promise<void> {
    await asOwner('seed test user', sql`
      INSERT INTO app_user (id, organization_id, account_type, email, status, full_name, employee_id, department_id, position_id)
      VALUES (${id}, ${organizationId}, 'employee', ${email}, 'active', ${name}, ${employeeId}, ${departmentId}, ${positionId})
    `);
  }

  const png = (width = 1200, height = 800) => sharp({ create: { width, height, channels: 3, background: '#3366ff' } }).png().toBuffer();
  async function pdf(pages: number): Promise<Buffer> {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));
    for (let i = 0; i < pages; i += 1) doc.addPage().text(`Invoice page ${i + 1}`);
    doc.end();
    await done;
    return Buffer.concat(chunks);
  }

  beforeAll(async () => {
    process.env['TAPCRM_UPLOAD_DIR'] = uploadDir;
    process.env['CHAT_STORAGE_DRIVER'] = 'local';
    process.env['CHAT_LINK_PREVIEW_ALLOW_PRIVATE_NETWORKS'] = 'true';
    __resetConfig();

    const dbName = new URL(migrationUrl).pathname;
    if (!dbName.includes('test')) throw new Error(`Refusing to run against "${dbName}"`);
    for (const [id, code] of [[orgA, 'RCHA'], [orgB, 'RCHB']] as const) {
      await asOwner('seed org', sql`INSERT INTO organization (id, code, name) VALUES (${id}, ${`${code}${id.slice(0, 6)}`}, ${code})`);
    }
    await asOwner('seed dept', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${deptA}, ${orgA}, 'D1', 'Dept', 'support')`);
    await asOwner('seed dept b', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${deptB}, ${orgB}, 'D1', 'Dept', 'support')`);
    await asOwner('seed pos a', sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${posA}, ${orgA}, ${deptA}, 'DEV', 'Developer', 20)`);
    await asOwner('seed pos b', sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${posB}, ${orgB}, ${deptB}, 'DEV', 'Developer', 20)`);
    await addUser(orgA, alice, 'Alice Rao', `alice-${alice.slice(0, 6)}@rich.invalid`, 'RICH-A1', deptA, posA);
    await addUser(orgA, bob, 'Bob Mehta', `bob-${bob.slice(0, 6)}@rich.invalid`, 'RICH-A2', deptA, posA);
    await addUser(orgA, carol, 'Carol Iyer', `carol-${carol.slice(0, 6)}@rich.invalid`, 'RICH-A3', deptA, posA);
    await addUser(orgB, outsider, 'Otto Side', `otto-${outsider.slice(0, 6)}@rich.invalid`, 'RICH-B1', deptB, posB);

    // A page with Open Graph tags and an image, on loopback (allowed only by the test flag).
    const card = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#ff6600' } }).png().toBuffer();
    ogServer = createServer((req, res) => {
      if (req.url === '/card.png') {
        res.writeHead(200, { 'content-type': 'image/png' }).end(card);
        return;
      }
      if (req.url === '/broken') {
        res.writeHead(500).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html><head>
        <title>ignored</title>
        <meta property="og:title" content="Project Scope v2">
        <meta property="og:description" content="Deliverables, milestones &amp; sign-off">
        <meta property="og:site_name" content="Scope Docs">
        <meta property="og:image" content="/card.png">
      </head><body>hello</body></html>`);
    });
    await new Promise<void>((resolve) => ogServer.listen(0, '127.0.0.1', () => resolve()));
    const address = ogServer.address();
    ogBase = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  });

  afterAll(async () => {
    const orgs = [orgA, orgB];
    for (const table of [
      'notification_delivery', 'notification', 'notification_outbox',
      'message_attachment', 'scheduled_message', 'message_star', 'message_pin', 'message_edit', 'message_link',
      'chat_link_preview', 'message_mention', 'message_reaction', 'message', 'conversation_member', 'conversation',
      'user_status', 'identity_email_directory', 'app_user', 'position', 'department',
    ]) {
      await asOwner(`cleanup ${table}`, sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ANY(${orgs}::uuid[])`);
    }
    await asOwner('cleanup orgs', sql`DELETE FROM organization WHERE id = ANY(${orgs}::uuid[])`);
    await closePools();
    await new Promise<void>((resolve) => ogServer.close(() => resolve()));
    rmSync(uploadDir, { recursive: true, force: true });
    __resetConfig();
  });

  /* ------------------------------------------------------------ attachments */

  describe('attachments', () => {
    it('uploads an image as a pending file with a thumbnail, then sends it on a message', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const uploaded = await uploadAttachment(asAlice(), dm.id, { fileName: 'mockup.png', body: await png() });
      expect(uploaded).toMatchObject({ kind: 'image', mimeType: 'image/png', fileName: 'mockup.png', width: 1200, height: 800 });
      expect(uploaded.thumbnailUrl).toMatch(/\/api\/chat-files\/.+\/a\/.+\/thumb\?exp=\d+&sig=/);

      const message = await sendMessage(asAlice(), dm.id, { body: '', attachmentIds: [uploaded.id] });
      expect(message.body).toBe('');
      expect(message.attachments.map((a) => a.id)).toEqual([uploaded.id]);

      // Bob (the other member) sees it; the conversation preview says what was shared.
      const page = await listMessages(asBob(), dm.id, { limit: 5 });
      expect(page.messages[0]!.attachments[0]!.fileName).toBe('mockup.png');
      const conversation = await getConversation(asBob(), dm.id);
      expect(conversation.lastMessage).toMatchObject({ attachmentCount: 1, firstAttachment: { kind: 'image', fileName: 'mockup.png' } });
    });

    it('strips EXIF (e.g. GPS) from JPEG photos and keeps them upright', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const withExif = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#00aa00' } })
        .jpeg()
        .withExif({ IFD0: { Make: 'PhoneCo', Model: 'Camera X' } })
        .toBuffer();
      expect((await sharp(withExif).metadata()).exif).toBeDefined();
      const uploaded = await uploadAttachment(asAlice(), dm.id, { fileName: 'site-visit.jpg', body: withExif });
      const [row] = await asOwner<{ objectKey: string }>('read', sql`SELECT object_key FROM message_attachment WHERE id = ${uploaded.id}`);
      const stored = readFileSync(localChatPath(row!.objectKey));
      expect((await sharp(stored).metadata()).exif).toBeUndefined();
    });

    it('records a PDF with its page count and refuses mismatched or unsupported files', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const invoice = await uploadAttachment(asAlice(), dm.id, { fileName: 'Invoice-Q3.pdf', body: await pdf(3) });
      expect(invoice).toMatchObject({ kind: 'pdf', pageCount: 3, thumbnailUrl: null });

      await expect(uploadAttachment(asAlice(), dm.id, { fileName: 'virus.exe', body: Buffer.from('MZ\u0000\u0000') })).rejects.toThrow(ChatValidationError);
      await expect(uploadAttachment(asAlice(), dm.id, { fileName: 'fake.png', body: await pdf(1) })).rejects.toThrow(/doesn't match/);
      await expect(uploadAttachment(asAlice(), dm.id, { fileName: 'empty.txt', body: Buffer.alloc(0) })).rejects.toThrow(/empty/);
    });

    it('only the uploader can attach or remove a pending upload, and only in its own conversation', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const other = await startDirectConversation(asAlice(), carol);
      const file = await uploadAttachment(asAlice(), dm.id, { fileName: 'notes.txt', body: Buffer.from('hello') });

      await expect(sendMessage(asBob(), dm.id, { body: 'stealing it', attachmentIds: [file.id] })).rejects.toThrow(/no longer available/);
      await expect(sendMessage(asAlice(), other.id, { body: 'wrong room', attachmentIds: [file.id] })).rejects.toThrow(/no longer available/);
      await expect(deletePendingAttachment(asBob(), file.id)).rejects.toThrow(ChatNotSenderError);

      await deletePendingAttachment(asAlice(), file.id);
      await expect(sendMessage(asAlice(), dm.id, { body: 'gone', attachmentIds: [file.id] })).rejects.toThrow(/no longer available/);

      // A failed send claims nothing: the message is rolled back with it.
      const page = await listMessages(asAlice(), dm.id, { limit: 50 });
      expect(page.messages.some((m) => m.body === 'stealing it' || m.body === 'gone')).toBe(false);
    });

    it('forwarding copies the files; unsending hides them and stops the file route serving them', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const group = await createInternalGroup(asAlice(), { name: 'Design Review', memberIds: [bob, carol] });
      const file = await uploadAttachment(asAlice(), dm.id, { fileName: 'brief.png', body: await png(600, 400) });
      const original = await sendMessage(asAlice(), dm.id, { body: 'the brief', attachmentIds: [file.id] });
      const copy = await forwardMessage(asBob(), original.id, group.id);
      expect(copy.attachments).toHaveLength(1);
      expect(copy.attachments[0]!.id).not.toBe(file.id);

      const app = express();
      app.use('/api/chat-files', buildChatFileRouter());
      const path = (url: string) => url.replace(/^\/api/, '/api');
      const served = await request(app).get(path(original.attachments[0]!.url)).buffer(true);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['content-disposition']).toMatch(/^inline; filename="brief.png"/);
      const thumb = await request(app).get(path(original.attachments[0]!.thumbnailUrl!));
      expect(thumb.status).toBe(200);
      expect(thumb.headers['content-type']).toBe('image/webp');
      const download = await request(app).get(path(original.attachments[0]!.downloadUrl));
      expect(download.headers['content-disposition']).toMatch(/^attachment;/);

      // A tampered signature or a different variant is refused.
      expect((await request(app).get(path(original.attachments[0]!.url).replace(/sig=[^&]+/, 'sig=AAAA'))).status).toBe(403);
      expect((await request(app).get(path(original.attachments[0]!.url).replace('/view?', '/download?'))).status).toBe(403);

      const unsent = await unsendMessage(asAlice(), original.id);
      expect(unsent.attachments).toEqual([]);
      expect((await request(app).get(path(original.attachments[0]!.url))).status).toBe(404);
      // The forwarded copy is independent of the original being unsent.
      expect((await request(app).get(path(copy.attachments[0]!.url))).status).toBe(200);
    });

    it('cleanup removes uploads nobody sent within a day, file included', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const stale = await uploadAttachment(asAlice(), dm.id, { fileName: 'draft.png', body: await png(200, 200) });
      const fresh = await uploadAttachment(asAlice(), dm.id, { fileName: 'fresh.png', body: await png(200, 200) });
      await asOwner('backdate', sql`UPDATE message_attachment SET created_at = now() - interval '25 hours' WHERE id = ${stale.id}`);
      const [row] = await asOwner<{ objectKey: string }>('read', sql`SELECT object_key FROM message_attachment WHERE id = ${stale.id}`);
      expect(existsSync(localChatPath(row!.objectKey))).toBe(true);

      const removed = await cleanupPendingAttachments(jobCtx(), new Date());
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(existsSync(localChatPath(row!.objectKey))).toBe(false);
      const left = await asOwner<{ id: string }>('read', sql`SELECT id FROM message_attachment WHERE id = ANY(${[stale.id, fresh.id]}::uuid[])`);
      expect(left.map((r) => r.id)).toEqual([fresh.id]);
    });
  });

  /* ---------------------------------------------------------------- search */

  describe('full-text search', () => {
    it('finds stemmed words and prefixes, highlights them, and honours every filter', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const group = await createInternalGroup(asAlice(), { name: 'Billing', memberIds: [bob] });
      const m1 = await sendMessage(asBob(), dm.id, { body: 'The invoices for Kumar Textiles are approved' });
      const m2 = await sendMessage(asAlice(), group.id, { body: 'Please send the revised invoice by Friday' });
      await sendMessage(asAlice(), group.id, { body: 'Unrelated lunch plans' });
      const pdfFile = await uploadAttachment(asAlice(), group.id, { fileName: 'Kumar-Textiles-PO.pdf', body: await pdf(1) });
      const m4 = await sendMessage(asAlice(), group.id, { body: 'Purchase order attached', attachmentIds: [pdfFile.id] });
      const m5 = await sendMessage(asBob(), group.id, { body: 'Spec: https://example.com/spec' });

      const stemmed = await searchMessages(asAlice(), { q: 'invoice', limit: 20 });
      expect(stemmed.results.map((r) => r.messageId)).toEqual(expect.arrayContaining([m1.id, m2.id]));
      expect(stemmed.results.find((r) => r.messageId === m1.id)!.snippet).toContain('⟦invoices⟧');
      expect(stemmed.results.find((r) => r.messageId === m1.id)!.conversationLabel).toBe('Bob Mehta');

      const prefix = await searchMessages(asAlice(), { q: 'textil', limit: 20 });
      // A file name match counts: m4's PDF is "Kumar-Textiles-PO.pdf".
      expect(prefix.results.map((r) => r.messageId)).toEqual(expect.arrayContaining([m1.id, m4.id]));

      const inGroup = await searchMessages(asAlice(), { q: 'invoice', conversationId: group.id, limit: 20 });
      expect(inGroup.results.map((r) => r.messageId)).toEqual([m2.id]);
      const fromBob = await searchMessages(asAlice(), { q: 'invoice', senderId: bob, limit: 20 });
      expect(fromBob.results.every((r) => r.senderId === bob)).toBe(true);
      const pdfs = await searchMessages(asAlice(), { type: 'pdf', conversationId: group.id, limit: 20 });
      expect(pdfs.results.map((r) => r.messageId)).toEqual([m4.id]);
      expect(pdfs.results[0]!.attachments[0]!.fileName).toBe('Kumar-Textiles-PO.pdf');
      const links = await searchMessages(asAlice(), { type: 'link', conversationId: group.id, limit: 20 });
      expect(links.results.map((r) => r.messageId)).toEqual([m5.id]);
      const future = await searchMessages(asAlice(), { q: 'invoice', from: new Date(Date.now() + 86_400_000), limit: 20 });
      expect(future.results).toEqual([]);
    });

    it('never returns messages from conversations the searcher is not in, or unsent ones', async () => {
      const bobCarol = await startDirectConversation(asBob(), carol);
      const secret = await sendMessage(asBob(), bobCarol.id, { body: 'confidential salary discussion' });
      expect((await searchMessages(asAlice(), { q: 'salary', limit: 20 })).results).toEqual([]);
      expect((await searchMessages(asCarol(), { q: 'salary', limit: 20 })).results.map((r) => r.messageId)).toEqual([secret.id]);
      await unsendMessage(asBob(), secret.id);
      expect((await searchMessages(asCarol(), { q: 'salary', limit: 20 })).results).toEqual([]);
      expect((await searchMessages(ctxFor(orgB, outsider), { q: 'invoice', limit: 20 })).results).toEqual([]);
    });

    it('pages results with a cursor and opens a window around a found message', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Firehose', memberIds: [bob] });
      const sent: string[] = [];
      for (let i = 1; i <= 30; i += 1) sent.push((await sendMessage(asAlice(), group.id, { body: `status update number ${i}` })).id);

      const first = await searchMessages(asAlice(), { q: 'status', conversationId: group.id, limit: 10 });
      expect(first.results).toHaveLength(10);
      const second = await searchMessages(asAlice(), { q: 'status', conversationId: group.id, limit: 10, cursor: first.nextCursor! });
      expect(second.results[0]!.messageId).toBe(sent[19]);

      const around = await listMessages(asAlice(), group.id, { limit: 10, around: sent[9] });
      const ids = around.messages.map((m) => m.id);
      expect(ids).toContain(sent[9]);
      expect(ids).toEqual([...sent.slice(4, 15)].reverse()); // 5 newer, the target, 5 older
      expect(around.nextCursor).not.toBeNull();
      expect(around.newerCursor).not.toBeNull();

      const newer = await listMessages(asAlice(), group.id, { limit: 10, after: around.newerCursor! });
      expect(newer.messages.map((m) => m.id)).toEqual([...sent.slice(15, 25)].reverse());
      const older = await listMessages(asAlice(), group.id, { limit: 10, cursor: around.nextCursor! });
      expect(older.messages.map((m) => m.id)).toEqual([...sent.slice(0, 4)].reverse());
    });
  });

  /* ---------------------------------------------------------------- editing */

  describe('editing', () => {
    it('the sender fixes a typo within 15 minutes; the history keeps the original', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Logistics', memberIds: [bob, carol] });
      const message = await sendMessage(asAlice(), group.id, { body: 'Ship to 12 MG Raod' });
      const edited = await editMessage(asAlice(), message.id, { body: 'Ship to 12 MG Road' });
      expect(edited.body).toBe('Ship to 12 MG Road');
      expect(edited.editedAt).not.toBeNull();
      const history = await getMessageEdits(asBob(), message.id);
      expect(history.map((h) => h.previousBody)).toEqual(['Ship to 12 MG Raod']);

      // Same text again: no new history row.
      await editMessage(asAlice(), message.id, { body: 'Ship to 12 MG Road' });
      expect(await getMessageEdits(asBob(), message.id)).toHaveLength(1);
      // Search follows the edit.
      expect((await searchMessages(asBob(), { q: 'raod', limit: 5 })).results).toEqual([]);
      expect((await searchMessages(asBob(), { q: 'road', conversationId: group.id, limit: 5 })).results.map((r) => r.messageId)).toEqual([message.id]);
    });

    it('refuses other people, forwarded copies, and edits after the window', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const message = await sendMessage(asAlice(), dm.id, { body: 'original' });
      await expect(editMessage(asBob(), message.id, { body: 'hijack' })).rejects.toThrow(ChatNotSenderError);
      const late = new Date(message.createdAt.getTime() + 16 * 60_000);
      await expect(editMessage(asAlice(), message.id, { body: 'too late' }, late)).rejects.toThrow(ChatEditWindowClosedError);
      const other = await startDirectConversation(asBob(), carol);
      const forwarded = await forwardMessage(asBob(), message.id, other.id);
      await expect(editMessage(asBob(), forwarded.id, { body: 'rewritten' })).rejects.toThrow(/forwarded/);
      await expect(editMessage(asAlice(), message.id, { body: '' })).rejects.toThrow(/cannot be empty/);
    });

    it('notifies only people NEWLY mentioned by an edit, and unsend clears the history', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Mentions Edit', memberIds: [bob, carol] });
      await dispatchOrganization(orgA);
      const message = await sendMessage(asAlice(), group.id, { body: '@Bob Mehta please check', mentionedUserIds: [bob] });
      await editMessage(asAlice(), message.id, { body: '@Bob Mehta and @Carol Iyer please check', mentionedUserIds: [bob, carol] });
      await dispatchOrganization(orgA);
      const mentionsFor = async (userId: string) => (await asOwner<{ title: string }>('read', sql`
        SELECT title FROM notification WHERE recipient_id = ${userId} AND metadata->>'conversationId' = ${group.id} AND title LIKE '%mentioned you%'
      `)).length;
      expect(await mentionsFor(bob)).toBe(1);
      expect(await mentionsFor(carol)).toBe(1);
      const after = await getMessage(asBob(), message.id);
      expect(after.mentions.map((m) => m.userId).sort()).toEqual([bob, carol].sort());

      await unsendMessage(asAlice(), message.id);
      expect(await getMessageEdits(asBob(), message.id)).toEqual([]);
    });
  });

  /* ---------------------------------------------------------- link previews */

  describe('link previews', () => {
    it('unfurls Open Graph into a cached card with our own copy of the image', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const url = `${ogBase}/scope`;
      const message = await sendMessage(asAlice(), dm.id, { body: `Scope is here: ${url}` });
      expect(message.linkPreviews).toEqual([]); // fetched after commit, never inline

      expect(await refreshLinkPreviews(jobCtx(), [url])).toBe(true);
      const after = await getMessage(asBob(), message.id);
      expect(after.linkPreviews).toHaveLength(1);
      expect(after.linkPreviews[0]).toMatchObject({ url, title: 'Project Scope v2', description: 'Deliverables, milestones & sign-off', siteName: 'Scope Docs' });
      expect(after.linkPreviews[0]!.imageUrl).toMatch(/\/api\/chat-files\/.+\/p\/local\/[0-9a-f]{64}\?exp=/);
      expect(after.linkPreviews[0]!.imageWidth).toBe(640);

      const app = express();
      app.use('/api/chat-files', buildChatFileRouter());
      const image = await request(app).get(after.linkPreviews[0]!.imageUrl!);
      expect(image.status).toBe(200);
      expect(image.headers['content-type']).toBe('image/webp');

      // Cached: a second refresh fetches nothing new.
      expect(await refreshLinkPreviews(jobCtx(), [url])).toBe(false);
    });

    it('a dead link gets no card (and is remembered as failed)', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const url = `${ogBase}/broken`;
      const message = await sendMessage(asAlice(), dm.id, { body: `see ${url}` });
      expect(await refreshLinkPreviews(jobCtx(), [url])).toBe(false);
      expect((await getMessage(asAlice(), message.id)).linkPreviews).toEqual([]);
      const [row] = await asOwner<{ status: string }>('read', sql`SELECT status FROM chat_link_preview WHERE organization_id = ${orgA} AND url = ${url}`);
      expect(row?.status).toBe('failed');
    });
  });

  /* ------------------------------------------------------------------- pins */

  describe('pinned messages', () => {
    it('any member pins and unpins; the list is newest-pin first and the conversation counts them', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Project Scope', memberIds: [bob, carol] });
      const scope = await sendMessage(asAlice(), group.id, { body: 'Scope: 5 pages, 2 revisions' });
      const approval = await sendMessage(asBob(), group.id, { body: 'Client approved the scope' });
      expect((await pinMessage(asBob(), scope.id)).pinnedBy).toBe(bob);
      await pinMessage(asCarol(), approval.id);
      await pinMessage(asCarol(), approval.id); // idempotent

      const pins = await listPins(asAlice(), group.id);
      expect(pins.map((p) => p.message.id)).toEqual([approval.id, scope.id]);
      expect(pins[0]).toMatchObject({ pinnedBy: carol, pinnedByName: 'Carol Iyer' });
      expect((await getConversation(asAlice(), group.id)).pinnedCount).toBe(2);

      await unpinMessage(asAlice(), scope.id);
      expect((await listPins(asAlice(), group.id)).map((p) => p.message.id)).toEqual([approval.id]);
      await unsendMessage(asBob(), approval.id); // unsend unpins
      expect(await listPins(asAlice(), group.id)).toEqual([]);
      await expect(pinMessage(asAlice(), approval.id)).rejects.toThrow(/unsent/);
    });
  });

  /* -------------------------------------------------------------- reactions */

  describe('reactions', () => {
    it('any emoji, several per person, each toggled independently', async () => {
      const dm = await startDirectConversation(asAlice(), bob);
      const message = await sendMessage(asAlice(), dm.id, { body: 'shipped 🚀' });
      const party = reactionSchema.parse({ emoji: '🥳' }).emoji;
      await reactToMessage(asBob(), message.id, party);
      await reactToMessage(asBob(), message.id, '👍🏽');
      const withTwo = await reactToMessage(asBob(), message.id, party);
      expect(withTwo.reactions.filter((r) => r.userId === bob).map((r) => r.emoji)).toEqual([party, '👍🏽']);
      const withOne = await removeReactionFromMessage(asBob(), message.id, party);
      expect(withOne.reactions).toEqual([{ userId: bob, emoji: '👍🏽' }]);
    });
  });

  /* ------------------------------------------------------------------ saved */

  describe('saved messages', () => {
    it('a personal tray: only mine, newest saved first, gone when I leave the conversation', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Requirements', memberIds: [bob, carol] });
      const req1 = await sendMessage(asAlice(), group.id, { body: 'Requirement: SSO login' });
      const req2 = await sendMessage(asAlice(), group.id, { body: 'Requirement: CSV export' });
      expect((await saveMessage(asBob(), req1.id)).saved).toBe(true);
      await saveMessage(asBob(), req2.id);
      expect((await getMessage(asAlice(), req1.id)).saved).toBe(false); // Alice did not save it

      const tray = await listSaved(asBob(), { limit: 10 });
      expect(tray.items.map((i) => i.message.id).slice(0, 2)).toEqual([req2.id, req1.id]);
      expect(tray.items[0]).toMatchObject({ senderName: 'Alice Rao', conversation: { id: group.id, kind: 'group', name: 'Requirements' } });
      expect((await listSaved(asCarol(), { limit: 10 })).items).toEqual([]);

      await unsaveMessage(asBob(), req1.id);
      expect((await listSaved(asBob(), { limit: 10 })).items.map((i) => i.message.id)).not.toContain(req1.id);

      await removeGroupMember(asAlice(), group.id, bob);
      expect((await listSaved(asBob(), { limit: 10 })).items.map((i) => i.message.id)).not.toContain(req2.id);
      await addGroupMembers(asAlice(), group.id, [bob]);
    });
  });

  /* -------------------------------------------------------------- scheduled */

  describe('send later', () => {
    it('schedules, edits and cancels; the job sends what is due as its author, with its files', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Client Updates', memberIds: [bob] });
      const now = new Date();
      await expect(scheduleMessage(asAlice(), group.id, { body: 'too soon', sendAt: new Date(now.getTime() + 5_000) })).rejects.toThrow(ChatValidationError);

      const file = await uploadAttachment(asAlice(), group.id, { fileName: 'weekly.pdf', body: await pdf(2) });
      const scheduled = await scheduleMessage(asAlice(), group.id, { body: 'Weekly report', attachmentIds: [file.id], sendAt: new Date(now.getTime() + 10 * 60_000) });
      expect(scheduled).toMatchObject({ status: 'pending', body: 'Weekly report' });
      expect(scheduled.attachments.map((a) => a.id)).toEqual([file.id]);
      const other = await scheduleMessage(asAlice(), group.id, { body: 'Cancel me', sendAt: new Date(now.getTime() + 60 * 60_000) });
      expect((await listScheduled(asAlice(), group.id)).map((s) => s.id)).toEqual([scheduled.id, other.id]);
      expect(await listScheduled(asBob(), group.id)).toEqual([]); // only the author's own

      await updateScheduled(asAlice(), scheduled.id, { body: 'Weekly report (final)' });
      await expect(updateScheduled(asBob(), scheduled.id, { body: 'nope' })).rejects.toThrow(ChatNotSenderError);
      await cancelScheduled(asAlice(), other.id);
      expect((await listScheduled(asAlice(), group.id)).map((s) => s.id)).toEqual([scheduled.id]);

      // Not yet due: nothing happens.
      expect(await sendDueScheduledMessages(jobCtx(), new Date(now.getTime() + 60_000))).toBe(0);
      // Due: sent as Alice, files moved onto the message, Bob notified.
      expect(await sendDueScheduledMessages(jobCtx(), new Date(now.getTime() + 11 * 60_000))).toBe(1);
      const page = await listMessages(asBob(), group.id, { limit: 5 });
      const delivered = page.messages[0]!;
      expect(delivered).toMatchObject({ senderId: alice, body: 'Weekly report (final)' });
      expect(delivered.attachments.map((a) => a.id)).toEqual([file.id]);
      const [row] = await asOwner<{ status: string; sentMessageId: string }>('read', sql`SELECT status, sent_message_id FROM scheduled_message WHERE id = ${scheduled.id}`);
      expect(row).toEqual({ status: 'sent', sentMessageId: delivered.id });
      // Running again sends nothing twice.
      expect(await sendDueScheduledMessages(jobCtx(), new Date(now.getTime() + 12 * 60_000))).toBe(0);
    });

    it('fails (and tells the author) when they left the conversation before it was due; "send now" works', async () => {
      const group = await createInternalGroup(asAlice(), { name: 'Leaving Room', memberIds: [bob, carol] });
      const now = new Date();
      const doomed = await scheduleMessage(asBob(), group.id, { body: 'after I leave', sendAt: new Date(now.getTime() + 2 * 60_000) });
      const soon = await scheduleMessage(asCarol(), group.id, { body: 'right now please', sendAt: new Date(now.getTime() + 30 * 60_000) });
      await removeGroupMember(asAlice(), group.id, bob);

      expect(await sendDueScheduledMessages(jobCtx(), new Date(now.getTime() + 3 * 60_000))).toBe(1);
      const [row] = await asOwner<{ status: string; failureReason: string }>('read', sql`SELECT status, failure_reason FROM scheduled_message WHERE id = ${doomed.id}`);
      expect(row?.status).toBe('failed');
      expect(row?.failureReason).toMatch(/no longer a member/);
      await dispatchOrganization(orgA);
      const notes = await asOwner<{ title: string }>('read', sql`SELECT title FROM notification WHERE recipient_id = ${bob} AND type = 'chat.scheduled_failed'`);
      expect(notes).toHaveLength(1);

      const result = await sendScheduledNow(asCarol(), soon.id);
      expect(result.sent).toBe(true);
      expect((await getMessage(asAlice(), result.messageId!)).body).toBe('right now please');
      await expect(sendScheduledNow(asCarol(), soon.id)).rejects.toThrow(/already sent/);
    });
  });

  /* --------------------------------------------------------------- presence */

  describe('presence', () => {
    it('reads live-status: working = active, on a break = idle, everyone else offline', async () => {
      for (const [userId, state] of [[alice, 'WORKING'], [bob, 'ON_BREAK']] as const) {
        await asOwner('seed status', sql`
          INSERT INTO user_status (organization_id, user_id, work_date, state, window_start, window_end, rollover_due_at)
          VALUES (${orgA}, ${userId}, (now() AT TIME ZONE ${OPERATIONAL_TZ})::date, ${state}, now(), now() + interval '1 day', now() + interval '1 day')
        `);
      }
      const presence = await presenceForColleagues(asCarol());
      expect(presence[alice]).toBe('active');
      expect(presence[bob]).toBe('idle');
      expect(presence[carol]).toBe('offline');
      expect(presence[outsider]).toBeUndefined();
    });
  });
});
