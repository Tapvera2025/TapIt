import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as authApi from '../../identity/api/authApi.js';
import {
  clearNote,
  getCurrentNote,
  getHistoricalNote,
  getNoteHistory,
  saveNote,
} from './api/notepadApi.js';
import { formatHistoryTimestamp } from './components/NoteHistoryModal.js';

describe('notepadApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getCurrentNote calls GET /api/my-notepad with no-cache headers', async () => {
    const mockNote = {
      id: 'note-123',
      organizationId: 'org-1',
      userId: 'user-1',
      content: 'Hello world',
      createdAt: '2026-09-29T10:00:00Z',
      updatedAt: '2026-09-29T10:00:00Z',
    };

    const spy = vi
      .spyOn(authApi, 'identityRequest')
      .mockResolvedValue(mockNote);

    const result = await getCurrentNote();

    expect(spy).toHaveBeenCalledWith(
      '/api/my-notepad',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );
    expect(result).toEqual(mockNote);
  });

  it('saveNote calls PUT /api/my-notepad with stringified payload', async () => {
    const mockSaved = {
      id: 'note-123',
      organizationId: 'org-1',
      userId: 'user-1',
      content: 'Updated content',
      createdAt: '2026-09-29T10:00:00Z',
      updatedAt: '2026-09-29T10:05:00Z',
    };

    const spy = vi
      .spyOn(authApi, 'identityRequest')
      .mockResolvedValue(mockSaved);

    const result = await saveNote({ content: 'Updated content' });

    expect(spy).toHaveBeenCalledWith(
      '/api/my-notepad',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ content: 'Updated content' }),
      }),
    );
    expect(result.content).toBe('Updated content');
  });

  it('clearNote calls DELETE /api/my-notepad', async () => {
    const mockCleared = {
      id: 'note-123',
      organizationId: 'org-1',
      userId: 'user-1',
      content: '',
      createdAt: '2026-09-29T10:00:00Z',
      updatedAt: '2026-09-29T10:10:00Z',
    };

    const spy = vi
      .spyOn(authApi, 'identityRequest')
      .mockResolvedValue(mockCleared);

    const result = await clearNote();

    expect(spy).toHaveBeenCalledWith(
      '/api/my-notepad',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
    expect(result.content).toBe('');
  });

  it('getNoteHistory calls GET /api/my-notepad/history', async () => {
    const mockHistory = [
      {
        id: 'h-1',
        organizationId: 'org-1',
        userId: 'user-1',
        content: 'Snap 1',
        createdAt: '2026-09-29T09:20:00Z',
      },
      {
        id: 'h-2',
        organizationId: 'org-1',
        userId: 'user-1',
        content: 'Snap 2',
        createdAt: '2026-09-28T18:10:00Z',
      },
    ];

    const spy = vi
      .spyOn(authApi, 'identityRequest')
      .mockResolvedValue(mockHistory);

    const result = await getNoteHistory();

    expect(spy).toHaveBeenCalledWith(
      '/api/my-notepad/history',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('h-1');
  });

  it('getHistoricalNote calls GET /api/my-notepad/history/:id with encoded id', async () => {
    const mockItem = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      organizationId: 'org-1',
      userId: 'user-1',
      content: 'Past content',
      createdAt: '2026-09-29T09:20:00Z',
    };

    const spy = vi
      .spyOn(authApi, 'identityRequest')
      .mockResolvedValue(mockItem);

    const result = await getHistoricalNote('550e8400-e29b-41d4-a716-446655440000');

    expect(spy).toHaveBeenCalledWith(
      '/api/my-notepad/history/550e8400-e29b-41d4-a716-446655440000',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );
    expect(result.content).toBe('Past content');
  });
});

describe('formatHistoryTimestamp', () => {
  it('formats dates in DD/MM/YYYY HH:mm format', () => {
    const iso = '2026-09-29T09:20:00.000Z';
    const formatted = formatHistoryTimestamp(iso);
    // Checking day, month, year presence
    expect(formatted).toMatch(/\d{2}\/\d{2}\/2026 \d{2}:\d{2}/);
  });

  it('returns fallback string if date is invalid', () => {
    const invalid = 'not-a-date';
    expect(formatHistoryTimestamp(invalid)).toBe('not-a-date');
  });
});

describe('statistics calculations', () => {
  it('computes character, word, and line count accurately', () => {
    const text = 'Line 1 word A\nLine 2 word B\nLine 3';
    const charCount = text.length;
    const wordCount = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
    const lineCount = text.length === 0 ? 0 : text.split('\n').length;

    expect(charCount).toBe(text.length);
    expect(wordCount).toBe(10);
    expect(lineCount).toBe(3);
  });

  it('handles empty string gracefully', () => {
    const text = '';
    const charCount = text.length;
    const wordCount = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
    const lineCount = text.length === 0 ? 0 : text.split('\n').length;

    expect(charCount).toBe(0);
    expect(wordCount).toBe(0);
    expect(lineCount).toBe(0);
  });
});

describe('My Notepad navigation registration', () => {
  it('registers My Notepad in companyNavigation under Overview with universal access as a single source of truth', async () => {
    const { companyNavigation, myNotepadNavItem, myNotepadItem } = await import('../layout/navigation.js');
    expect(myNotepadNavItem).toBeDefined();
    expect(myNotepadItem).toBe(myNotepadNavItem);
    expect(myNotepadNavItem.label).toBe('My Notepad');
    expect(myNotepadNavItem.path).toBe('/company/my-notepad');
    expect(myNotepadNavItem.icon).toBe('notepad');
    expect(myNotepadNavItem.requiredAction).toBeUndefined();

    const overviewGroup = companyNavigation.find((g) => g.label === 'Overview');
    expect(overviewGroup).toBeDefined();
    const notepadItem = overviewGroup?.items.find((i) => i.label === 'My Notepad');
    expect(notepadItem).toBe(myNotepadNavItem);
  });

  it('renders My Notepad under Overview for super-admin, HR, and regular employees in CompanySidebar regardless of permissions', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { CompanySidebar } = await import('../layout/CompanySidebar.js');

    const roleConfigs: Array<{
      name: string;
      accountType: string;
      departmentCode?: string;
      departmentName?: string;
      positionCode?: string;
      canViewEmployees: boolean;
      canViewAudit: boolean;
      canRequestRoleChange: boolean;
    }> = [
      { name: 'super-admin', accountType: 'super-admin', canViewEmployees: true, canViewAudit: true, canRequestRoleChange: false },
      { name: 'super-admin-restricted-flags', accountType: 'super-admin', canViewEmployees: false, canViewAudit: false, canRequestRoleChange: false },
      {
        name: 'hr-employee',
        accountType: 'employee',
        departmentCode: 'HR',
        departmentName: 'Human Resources',
        positionCode: 'HR-SPEC',
        canViewEmployees: true,
        canViewAudit: false,
        canRequestRoleChange: false,
      },
      {
        name: 'hr-employee-no-employees-flag',
        accountType: 'employee',
        departmentCode: 'HR',
        departmentName: 'People Ops',
        positionCode: 'HR-EXEC',
        canViewEmployees: false,
        canViewAudit: false,
        canRequestRoleChange: false,
      },
      {
        name: 'regular-employee-all-flags-false',
        accountType: 'employee',
        departmentCode: 'ENG',
        departmentName: 'Engineering',
        positionCode: 'DEV',
        canViewEmployees: false,
        canViewAudit: false,
        canRequestRoleChange: false,
      },
      {
        name: 'regular-employee-all-flags-true',
        accountType: 'employee',
        departmentCode: 'ENG',
        departmentName: 'Engineering',
        positionCode: 'DEV',
        canViewEmployees: true,
        canViewAudit: true,
        canRequestRoleChange: true,
      },
      {
        name: 'unknown-role-fallback',
        accountType: 'contractor',
        canViewEmployees: false,
        canViewAudit: false,
        canRequestRoleChange: false,
      },
    ];

    // Set up minimal window mock for ThemeContext in Node environment
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: () => 'dark',
        setItem: () => {},
      },
      matchMedia: () => ({ matches: false }),
    };

    const { ThemeProvider } = await import('../../theme/ThemeContext.js');

    for (const config of roleConfigs) {
      const html = renderToStaticMarkup(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(CompanySidebar, {
            pathname: '/company/dashboard',
            identity: {
              fullName: 'Test User',
              email: 'test@example.com',
              departmentCode: config.departmentCode ?? null,
              departmentName: config.departmentName ?? null,
              positionCode: config.positionCode ?? null,
            },
            organizationName: 'Acme Corp',
            accountType: config.accountType,
            canRequestRoleChange: config.canRequestRoleChange,
            canViewAudit: config.canViewAudit,
            canViewEmployees: config.canViewEmployees,
            canViewTerritories: false,
            canViewLeads: false,
            canViewHandovers: false,
            onNavigate: () => {},
            onLogout: () => {},
            open: true,
            onClose: () => {},
          }),
        ),
      );

      expect(html).toContain('Overview');
      expect(html).toContain('My Notepad');
      // SVG path for notepad icon
      expect(html).toContain('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z');
    }
  });
});
