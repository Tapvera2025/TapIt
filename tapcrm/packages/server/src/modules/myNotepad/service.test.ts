import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { NotFoundError } from '../../platform/http/error-handler.js';
import * as repository from './repository.js';
import {
  clearNote,
  getCurrentNote,
  getHistoricalNote,
  getNoteHistory,
  saveNote,
} from './service.js';

describe('My Notepad service logic', () => {
  const orgId = randomUUID();
  const userId = randomUUID();

  function createTestContext(): RequestContext {
    return createRequestContext({
      organizationId: orgId,
      principal: {
        id: userId,
        organizationId: orgId,
        accountType: 'super-admin',
        sessionVersion: 1,
      },
      requestId: 'test-req',
    });
  }

  describe('getCurrentNote', () => {
    it('returns empty notepad structure when note does not exist yet', async () => {
      const ctx = createTestContext();
      vi.spyOn(repository, 'findCurrentNoteRow').mockResolvedValueOnce(null);

      const result = await getCurrentNote(ctx);

      expect(result).toEqual({
        id: null,
        organizationId: orgId,
        userId: userId,
        content: '',
        createdAt: null,
        updatedAt: null,
      });
    });

    it('returns mapped notepad structure when note exists', async () => {
      const ctx = createTestContext();
      const noteId = randomUUID();
      const now = new Date();
      vi.spyOn(repository, 'findCurrentNoteRow').mockResolvedValueOnce({
        id: noteId,
        organizationId: orgId,
        userId: userId,
        content: 'Existing note content',
        createdAt: now,
        updatedAt: now,
      });

      const result = await getCurrentNote(ctx);

      expect(result).toEqual({
        id: noteId,
        organizationId: orgId,
        userId: userId,
        content: 'Existing note content',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    });
  });

  describe('saveNote', () => {
    it('saves note inside transaction and returns mapped result', async () => {
      const ctx = createTestContext();
      const noteId = randomUUID();
      const historyId = randomUUID();
      const now = new Date();

      vi.spyOn(db, 'transaction').mockImplementationOnce(async (_ctx, fn) => {
        return fn({} as never);
      });

      const saveTxSpy = vi.spyOn(repository, 'saveNoteTx').mockResolvedValueOnce({
        note: {
          id: noteId,
          organizationId: orgId,
          userId: userId,
          content: 'Newly saved note',
          createdAt: now,
          updatedAt: now,
        },
        history: {
          id: historyId,
          organizationId: orgId,
          userId: userId,
          content: 'Newly saved note',
          createdAt: now,
        },
      });

      const result = await saveNote(ctx, { content: 'Newly saved note' });

      expect(saveTxSpy).toHaveBeenCalledWith(
        expect.anything(),
        orgId,
        userId,
        'Newly saved note',
      );
      expect(result).toEqual({
        id: noteId,
        organizationId: orgId,
        userId: userId,
        content: 'Newly saved note',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    });
  });

  describe('clearNote', () => {
    it('clears note and returns mapped result with empty content', async () => {
      const ctx = createTestContext();
      const noteId = randomUUID();
      const now = new Date();

      const clearSpy = vi.spyOn(repository, 'clearCurrentNoteRow').mockResolvedValueOnce({
        id: noteId,
        organizationId: orgId,
        userId: userId,
        content: '',
        createdAt: now,
        updatedAt: now,
      });

      const result = await clearNote(ctx);

      expect(clearSpy).toHaveBeenCalledWith(ctx);
      expect(result).toEqual({
        id: noteId,
        organizationId: orgId,
        userId: userId,
        content: '',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    });
  });

  describe('getNoteHistory', () => {
    it('returns formatted history snapshots', async () => {
      const ctx = createTestContext();
      const hist1 = randomUUID();
      const hist2 = randomUUID();
      const date1 = new Date('2026-09-29T10:00:00Z');
      const date2 = new Date('2026-09-29T09:00:00Z');

      vi.spyOn(repository, 'listNoteHistoryRows').mockResolvedValueOnce([
        {
          id: hist1,
          organizationId: orgId,
          userId: userId,
          content: 'Snapshot 2',
          createdAt: date1,
        },
        {
          id: hist2,
          organizationId: orgId,
          userId: userId,
          content: 'Snapshot 1',
          createdAt: date2,
        },
      ]);

      const result = await getNoteHistory(ctx);

      expect(result).toEqual([
        {
          id: hist1,
          organizationId: orgId,
          userId: userId,
          content: 'Snapshot 2',
          createdAt: date1.toISOString(),
        },
        {
          id: hist2,
          organizationId: orgId,
          userId: userId,
          content: 'Snapshot 1',
          createdAt: date2.toISOString(),
        },
      ]);
    });
  });

  describe('getHistoricalNote', () => {
    it('returns historical note when found', async () => {
      const ctx = createTestContext();
      const histId = randomUUID();
      const date = new Date('2026-09-29T10:00:00Z');

      vi.spyOn(repository, 'findHistoricalNoteRowById').mockResolvedValueOnce({
        id: histId,
        organizationId: orgId,
        userId: userId,
        content: 'Historical content',
        createdAt: date,
      });

      const result = await getHistoricalNote(ctx, histId);

      expect(result).toEqual({
        id: histId,
        organizationId: orgId,
        userId: userId,
        content: 'Historical content',
        createdAt: date.toISOString(),
      });
    });

    it('throws NotFoundError when historical note is not found', async () => {
      const ctx = createTestContext();
      const histId = randomUUID();

      vi.spyOn(repository, 'findHistoricalNoteRowById').mockResolvedValueOnce(null);

      await expect(getHistoricalNote(ctx, histId)).rejects.toThrow(NotFoundError);
    });
  });
});
