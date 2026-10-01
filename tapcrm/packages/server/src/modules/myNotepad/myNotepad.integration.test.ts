import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { NotFoundError } from '../../platform/http/error-handler.js';
import {
  clearNote,
  getCurrentNote,
  getHistoricalNote,
  getNoteHistory,
  saveNote,
} from './service.js';

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

describe.skipIf(!enabled)('My Notepad Integration (PostgreSQL)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA1 = randomUUID();
  const userA2 = randomUUID();
  const userB1 = randomUUID();

  const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
    platformDb.query('migration', reason, fragment);

  function ctxFor(organizationId: string, userId: string): RequestContext {
    const principal: Principal = {
      id: userId,
      organizationId,
      accountType: 'super-admin',
      sessionVersion: 1,
    };
    return createRequestContext({
      organizationId,
      principal,
      requestId: `test-${userId}`,
    });
  }

  const ctxA1 = () => ctxFor(orgA, userA1);
  const ctxA2 = () => ctxFor(orgA, userA2);
  const ctxB1 = () => ctxFor(orgB, userB1);

  beforeAll(async () => {
    // 1. Seed organizations
    for (const [id, code] of [
      [orgA, 'NPA'],
      [orgB, 'NPB'],
    ] as const) {
      await asOwner(
        'seed org',
        sql`INSERT INTO organization (id, code, name, status)
            VALUES (${id}, ${`${code}_${id.slice(0, 6)}`}, ${code}, 'active')`,
      );
    }

    // 2. Seed users (super-admin avoids needing dummy department/position rows)
    for (const [orgId, userId, name] of [
      [orgA, userA1, 'User A1'],
      [orgA, userA2, 'User A2'],
      [orgB, userB1, 'User B1'],
    ] as const) {
      await asOwner(
        'seed user',
        sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name, status)
            VALUES (${userId}, ${orgId}, 'super-admin', ${`${userId}@notepad-test.invalid`}, ${name}, 'active')`,
      );
    }
  });

  afterAll(async () => {
    try {
      await asOwner(
        'cleanup notepad history',
        sql`DELETE FROM my_notepad_history WHERE organization_id IN (${orgA}, ${orgB})`,
      );
      await asOwner(
        'cleanup notepad',
        sql`DELETE FROM my_notepad WHERE organization_id IN (${orgA}, ${orgB})`,
      );
      await asOwner(
        'cleanup identity email directory',
        sql`DELETE FROM identity_email_directory WHERE organization_id IN (${orgA}, ${orgB})`,
      );
      await asOwner(
        'cleanup users',
        sql`DELETE FROM app_user WHERE organization_id IN (${orgA}, ${orgB})`,
      );
      await asOwner(
        'cleanup orgs',
        sql`DELETE FROM organization WHERE id IN (${orgA}, ${orgB})`,
      );
    } finally {
      await closePools();
    }
  });

  it('initial state: user has empty notepad', async () => {
    const note = await getCurrentNote(ctxA1());
    expect(note.id).toBeNull();
    expect(note.content).toBe('');
    expect(note.organizationId).toBe(orgA);
    expect(note.userId).toBe(userA1);
  });

  it('1 & 4. Authenticated user can save a note and history snapshot is created', async () => {
    const saved = await saveNote(ctxA1(), { content: 'Initial note content' });
    expect(saved.id).toBeDefined();
    expect(saved.content).toBe('Initial note content');
    expect(saved.organizationId).toBe(orgA);
    expect(saved.userId).toBe(userA1);

    // Verify current note retrieves the saved content
    const current = await getCurrentNote(ctxA1());
    expect(current.id).toBe(saved.id);
    expect(current.content).toBe('Initial note content');

    // Verify history snapshot was created
    const history = await getNoteHistory(ctxA1());
    expect(history).toHaveLength(1);
    expect(history[0]?.content).toBe('Initial note content');
    expect(history[0]?.userId).toBe(userA1);
  });

  it('saving updates current note and creates additional history snapshot', async () => {
    const updated = await saveNote(ctxA1(), { content: 'Second revision' });
    expect(updated.content).toBe('Second revision');

    const current = await getCurrentNote(ctxA1());
    expect(current.content).toBe('Second revision');

    const history = await getNoteHistory(ctxA1());
    expect(history).toHaveLength(2);
    // Newest first
    expect(history[0]?.content).toBe('Second revision');
    expect(history[1]?.content).toBe('Initial note content');
  });

  it('6. Historical note can be previewed by ID', async () => {
    const history = await getNoteHistory(ctxA1());
    const firstSnapshot = history[1]; // 'Initial note content'
    expect(firstSnapshot).toBeDefined();

    const preview = await getHistoricalNote(ctxA1(), firstSnapshot!.id);
    expect(preview.id).toBe(firstSnapshot!.id);
    expect(preview.content).toBe('Initial note content');
    expect(preview.userId).toBe(userA1);
  });

  it('3 & 7. Clearing current note resets content to empty but preserves history', async () => {
    const cleared = await clearNote(ctxA1());
    expect(cleared.content).toBe('');

    const current = await getCurrentNote(ctxA1());
    expect(current.content).toBe('');

    // History remains intact (2 entries)
    const history = await getNoteHistory(ctxA1());
    expect(history).toHaveLength(2);
  });

  it('8. User A cannot access User B note', async () => {
    // User A2 saves a note
    await saveNote(ctxA2(), { content: 'Private note of User A2' });

    // User A1 checks current note -> sees their own (cleared/empty), not A2's
    const noteA1 = await getCurrentNote(ctxA1());
    expect(noteA1.content).toBe('');

    const noteA2 = await getCurrentNote(ctxA2());
    expect(noteA2.content).toBe('Private note of User A2');
  });

  it('9. User A cannot access User B history', async () => {
    const historyA2 = await getNoteHistory(ctxA2());
    expect(historyA2).toHaveLength(1);
    const snapId = historyA2[0]?.id;
    expect(snapId).toBeDefined();

    // User A1 attempts to preview User A2's snapshot
    await expect(getHistoricalNote(ctxA1(), snapId!)).rejects.toThrow(NotFoundError);
  });

  it('10. Cross-organization access is completely isolated', async () => {
    await saveNote(ctxB1(), { content: 'Org B User 1 note' });

    const noteB1 = await getCurrentNote(ctxB1());
    expect(noteB1.content).toBe('Org B User 1 note');
    expect(noteB1.organizationId).toBe(orgB);

    // Cross-org preview attempt
    const historyB1 = await getNoteHistory(ctxB1());
    expect(historyB1[0]).toBeDefined();
    await expect(getHistoricalNote(ctxA1(), historyB1[0]!.id)).rejects.toThrow(NotFoundError);
  });
});
