import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestContext } from '../../../platform/dal/context.js';
import { NotFoundError } from '../../../platform/http/error-handler.js';
import * as repo from './repository.js';
import {
  getEmployeeCurrentNote,
  getEmployeeHistoricalNote,
  getEmployeeNoteHistory,
  listEmployeeNotes,
  loadNotepadResource,
} from './service.js';

describe('Admin Employee Notes Service', () => {
  const orgId = randomUUID();
  const userId = randomUUID();

  const ctx = createRequestContext({
    organizationId: orgId,
    principal: {
      id: randomUUID(),
      organizationId: orgId,
      accountType: 'super-admin',
      sessionVersion: 1,
    },
    requestId: 'test-req',
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadNotepadResource', () => {
    it('returns resource object when employee exists in organization', async () => {
      vi.spyOn(repo, 'findEmployeeInOrg').mockResolvedValueOnce({
        id: userId,
        organizationId: orgId,
        fullName: 'Jane Doe',
      });

      const resource = await loadNotepadResource(ctx, userId);
      expect(resource).toEqual({
        type: 'notepad',
        id: userId,
        userId,
        ownerId: userId,
        organizationId: orgId,
      });
    });

    it('returns null when employee does not exist in organization', async () => {
      vi.spyOn(repo, 'findEmployeeInOrg').mockResolvedValueOnce(null);

      const resource = await loadNotepadResource(ctx, userId);
      expect(resource).toBeNull();
    });
  });

  describe('listEmployeeNotes', () => {
    it('delegates to repository with filters', async () => {
      const mockResult = {
        items: [
          {
            userId,
            name: 'Jane Doe',
            email: 'jane@example.com',
            department: 'Sales',
            designation: 'Account Executive',
            hasNote: true,
            lastUpdatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      };

      const spy = vi.spyOn(repo, 'listEmployeeNotes').mockResolvedValueOnce(mockResult);

      const res = await listEmployeeNotes(ctx, { department: 'Sales', search: 'Jane' });
      expect(res).toEqual(mockResult);
      expect(spy).toHaveBeenCalledWith(ctx, { department: 'Sales', search: 'Jane' });
    });
  });

  describe('getEmployeeCurrentNote', () => {
    it('throws NotFoundError if employee does not exist in organization', async () => {
      vi.spyOn(repo, 'findEmployeeInOrg').mockResolvedValueOnce(null);

      await expect(getEmployeeCurrentNote(ctx, userId)).rejects.toThrow(NotFoundError);
    });

    it('returns empty note structure if employee has not created a note yet', async () => {
      vi.spyOn(repo, 'findEmployeeInOrg').mockResolvedValueOnce({
        id: userId,
        organizationId: orgId,
        fullName: 'Jane Doe',
      });
      vi.spyOn(repo, 'findEmployeeNoteRow').mockResolvedValueOnce(null);

      const note = await getEmployeeCurrentNote(ctx, userId);
      expect(note).toEqual({
        id: null,
        organizationId: orgId,
        userId,
        content: '',
        createdAt: null,
        updatedAt: null,
      });
    });

    it('returns formatted note when employee has an existing note', async () => {
      const noteId = randomUUID();
      const now = new Date();
      vi.spyOn(repo, 'findEmployeeInOrg').mockResolvedValueOnce({
        id: userId,
        organizationId: orgId,
        fullName: 'Jane Doe',
      });
      vi.spyOn(repo, 'findEmployeeNoteRow').mockResolvedValueOnce({
        id: noteId,
        organizationId: orgId,
        userId,
        content: 'Existing employee note',
        createdAt: now,
        updatedAt: now,
      });

      const note = await getEmployeeCurrentNote(ctx, userId);
      expect(note.id).toBe(noteId);
      expect(note.content).toBe('Existing employee note');
      expect(note.createdAt).toBe(now.toISOString());
    });
  });

  describe('getEmployeeNoteHistory', () => {
    it('throws NotFoundError if employee does not exist in organization', async () => {
      vi.spyOn(repo, 'findEmployeeInOrg').mockResolvedValueOnce(null);

      await expect(getEmployeeNoteHistory(ctx, userId)).rejects.toThrow(NotFoundError);
    });

    it('returns formatted history list when employee exists', async () => {
      const histId = randomUUID();
      const now = new Date();
      vi.spyOn(repo, 'findEmployeeInOrg').mockResolvedValueOnce({
        id: userId,
        organizationId: orgId,
        fullName: 'Jane Doe',
      });
      vi.spyOn(repo, 'listEmployeeNoteHistoryRows').mockResolvedValueOnce([
        {
          id: histId,
          organizationId: orgId,
          userId,
          content: 'History note 1',
          createdAt: now,
        },
      ]);

      const history = await getEmployeeNoteHistory(ctx, userId);
      expect(history).toHaveLength(1);
      expect(history[0]?.id).toBe(histId);
      expect(history[0]?.content).toBe('History note 1');
    });
  });

  describe('getEmployeeHistoricalNote', () => {
    it('throws NotFoundError if employee does not exist in organization', async () => {
      vi.spyOn(repo, 'findEmployeeInOrg').mockResolvedValueOnce(null);

      await expect(getEmployeeHistoricalNote(ctx, userId, randomUUID())).rejects.toThrow(
        NotFoundError,
      );
    });

    it('throws NotFoundError if historical snapshot is not found', async () => {
      vi.spyOn(repo, 'findEmployeeInOrg').mockResolvedValueOnce({
        id: userId,
        organizationId: orgId,
        fullName: 'Jane Doe',
      });
      vi.spyOn(repo, 'findEmployeeHistoricalNoteRowById').mockResolvedValueOnce(null);

      await expect(getEmployeeHistoricalNote(ctx, userId, randomUUID())).rejects.toThrow(
        NotFoundError,
      );
    });

    it('returns historical snapshot when found', async () => {
      const histId = randomUUID();
      const now = new Date();
      vi.spyOn(repo, 'findEmployeeInOrg').mockResolvedValueOnce({
        id: userId,
        organizationId: orgId,
        fullName: 'Jane Doe',
      });
      vi.spyOn(repo, 'findEmployeeHistoricalNoteRowById').mockResolvedValueOnce({
        id: histId,
        organizationId: orgId,
        userId,
        content: 'Historical revision',
        createdAt: now,
      });

      const snapshot = await getEmployeeHistoricalNote(ctx, userId, histId);
      expect(snapshot.id).toBe(histId);
      expect(snapshot.content).toBe('Historical revision');
    });
  });
});
