import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as authApi from '../../identity/api/authApi.js';
import {
  getEmployeeCurrentNote,
  getEmployeeHistoricalNote,
  getEmployeeNoteHistory,
  listEmployeeNotes,
} from './api/notepadApi.js';
import { EmployeeNoteHistoryModal } from './components/admin/EmployeeNoteHistoryModal.js';
import { EmployeeNotesFilters } from './components/admin/EmployeeNotesFilters.js';
import { EmployeeNotesList } from './components/admin/EmployeeNotesList.js';
import { EmployeeNoteViewer } from './components/admin/EmployeeNoteViewer.js';
import type {
  EmployeeNoteListItem,
  MyNotepad,
  MyNotepadHistoryItem,
} from './types/index.js';

describe('Employee Notes Admin API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listEmployeeNotes passes query parameters correctly', async () => {
    const mockResponse = {
      items: [
        {
          userId: 'user-1',
          name: 'Alice Smith',
          email: 'alice@example.com',
          department: 'Engineering',
          designation: 'Senior Developer',
          hasNote: true,
          lastUpdatedAt: '2026-09-29T10:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    };

    const spy = vi
      .spyOn(authApi, 'identityRequest')
      .mockResolvedValue(mockResponse);

    const result = await listEmployeeNotes({
      department: 'Engineering',
      search: 'Alice',
      page: 2,
      limit: 10,
    });

    expect(spy).toHaveBeenCalledWith(
      '/api/admin/employee-notes?department=Engineering&search=Alice&page=2&limit=10',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Alice Smith');
  });

  it('listEmployeeNotes handles empty filter', async () => {
    const mockResponse = {
      items: [],
      total: 0,
      page: 1,
      limit: 50,
    };

    const spy = vi
      .spyOn(authApi, 'identityRequest')
      .mockResolvedValue(mockResponse);

    const result = await listEmployeeNotes();

    expect(spy).toHaveBeenCalledWith(
      '/api/admin/employee-notes',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );
    expect(result.total).toBe(0);
  });

  it('getEmployeeCurrentNote calls GET /api/admin/employee-notes/:userId', async () => {
    const mockNote: MyNotepad = {
      id: 'note-1',
      organizationId: 'org-1',
      userId: 'user-456',
      content: 'Important work notes',
      createdAt: '2026-09-29T10:00:00Z',
      updatedAt: '2026-09-29T11:00:00Z',
    };

    const spy = vi
      .spyOn(authApi, 'identityRequest')
      .mockResolvedValue(mockNote);

    const result = await getEmployeeCurrentNote('user-456');

    expect(spy).toHaveBeenCalledWith(
      '/api/admin/employee-notes/user-456',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );
    expect(result.content).toBe('Important work notes');
  });

  it('getEmployeeNoteHistory calls GET /api/admin/employee-notes/:userId/history', async () => {
    const mockHistory: MyNotepadHistoryItem[] = [
      {
        id: 'hist-1',
        organizationId: 'org-1',
        userId: 'user-456',
        content: 'Initial thoughts',
        createdAt: '2026-09-29T09:00:00Z',
      },
    ];

    const spy = vi
      .spyOn(authApi, 'identityRequest')
      .mockResolvedValue(mockHistory);

    const result = await getEmployeeNoteHistory('user-456');

    expect(spy).toHaveBeenCalledWith(
      '/api/admin/employee-notes/user-456/history',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('Initial thoughts');
  });

  it('getEmployeeHistoricalNote calls GET /api/admin/employee-notes/:userId/history/:historyId', async () => {
    const mockSnapshot: MyNotepadHistoryItem = {
      id: 'hist-99',
      organizationId: 'org-1',
      userId: 'user-456',
      content: 'Snapshot snapshot',
      createdAt: '2026-09-29T08:00:00Z',
    };

    const spy = vi
      .spyOn(authApi, 'identityRequest')
      .mockResolvedValue(mockSnapshot);

    const result = await getEmployeeHistoricalNote('user-456', 'hist-99');

    expect(spy).toHaveBeenCalledWith(
      '/api/admin/employee-notes/user-456/history/hist-99',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );
    expect(result.content).toBe('Snapshot snapshot');
  });
});

describe('EmployeeNotesFilters component', () => {
  it('renders department dropdown options and search input', () => {
    const departments = [
      { id: 'dept-1', name: 'Engineering', code: 'ENG', kind: 'standard', status: 'active' },
      { id: 'dept-2', name: 'Human Resources', code: 'HR', kind: 'standard', status: 'active' },
    ];

    const html = renderToStaticMarkup(
      React.createElement(EmployeeNotesFilters, {
        departments,
        selectedDepartment: 'Engineering',
        onSelectDepartment: () => {},
        search: 'Alice',
        onSearchChange: () => {},
        onClearFilters: () => {},
      }),
    );

    expect(html).toContain('All Departments');
    expect(html).toContain('Engineering');
    expect(html).toContain('Human Resources');
    expect(html).toContain('value="Alice"');
    expect(html).toContain('Reset Filters');
  });
});

describe('EmployeeNotesList component', () => {
  const mockEmployees: readonly EmployeeNoteListItem[] = [
    {
      userId: 'user-1',
      name: 'Bob Johnson',
      email: 'bob@example.com',
      department: 'Engineering',
      designation: 'Staff Engineer',
      hasNote: true,
      lastUpdatedAt: '2026-09-29T10:00:00Z',
    },
    {
      userId: 'user-2',
      name: 'Charlie Brown',
      email: 'charlie@example.com',
      department: 'HR',
      designation: 'Recruiter',
      hasNote: false,
      lastUpdatedAt: null,
    },
  ];

  it('renders employee details and note status badges', () => {
    const html = renderToStaticMarkup(
      React.createElement(EmployeeNotesList, {
        items: mockEmployees,
        total: 2,
        page: 1,
        limit: 10,
        onPageChange: () => {},
        onSelectEmployee: () => {},
        hasActiveFilters: false,
      }),
    );

    expect(html).toContain('Bob Johnson');
    expect(html).toContain('bob@example.com');
    expect(html).toContain('Staff Engineer');
    expect(html).toContain('Has Note');

    expect(html).toContain('Charlie Brown');
    expect(html).toContain('charlie@example.com');
    expect(html).toContain('No Note');
  });

  it('renders empty state when no employees match filters', () => {
    const html = renderToStaticMarkup(
      React.createElement(EmployeeNotesList, {
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        onPageChange: () => {},
        onSelectEmployee: () => {},
        hasActiveFilters: true,
      }),
    );

    expect(html).toContain('No employees match your search or filter.');
  });

  it('renders pagination controls when total exceeds limit', () => {
    const html = renderToStaticMarkup(
      React.createElement(EmployeeNotesList, {
        items: mockEmployees,
        total: 25,
        page: 1,
        limit: 10,
        onPageChange: () => {},
        onSelectEmployee: () => {},
        hasActiveFilters: false,
      }),
    );

    expect(html).toContain('Showing');
    expect(html).toContain('Page 1 of 3');
    expect(html).toContain('Previous');
    expect(html).toContain('Next');
  });
});

describe('EmployeeNoteViewer component', () => {
  const employee: EmployeeNoteListItem = {
    userId: 'user-1',
    name: 'Siddhartha Banerjee',
    email: 'siddhartha@example.com',
    department: 'Engineering',
    designation: 'Developer',
    hasNote: true,
    lastUpdatedAt: '2026-09-29T10:00:00Z',
  };

  it('displays employee note in strictly read-only mode without edit/save/clear/delete buttons', () => {
    const note: MyNotepad = {
      id: 'note-1',
      organizationId: 'org-1',
      userId: 'user-1',
      content: 'Current strategic objectives for the quarter.',
      createdAt: '2026-09-29T08:00:00Z',
      updatedAt: '2026-09-29T10:00:00Z',
    };

    const html = renderToStaticMarkup(
      React.createElement(EmployeeNoteViewer, {
        employee,
        note,
        loading: false,
        error: null,
        onViewHistory: () => {},
        onClose: () => {},
      }),
    );

    expect(html).toContain('Siddhartha Banerjee');
    expect(html).toContain('Engineering · Developer');
    expect(html).toContain('Read-Only');
    expect(html).toContain('Current strategic objectives for the quarter.');
    expect(html).toContain('View History');

    // Strict validation: Must NOT contain mutating buttons/controls
    expect(html).not.toContain('Save');
    expect(html).not.toContain('Clear');
    expect(html).not.toContain('Delete');
    expect(html).not.toContain('Edit');
    expect(html).not.toContain('<textarea');
  });

  it('displays empty state when employee has no note content', () => {
    const emptyNote: MyNotepad = {
      id: null,
      organizationId: 'org-1',
      userId: 'user-1',
      content: '',
      createdAt: null,
      updatedAt: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(EmployeeNoteViewer, {
        employee,
        note: emptyNote,
        loading: false,
        error: null,
        onViewHistory: () => {},
        onClose: () => {},
      }),
    );

    expect(html).toContain('No note content recorded yet.');
    expect(html).toContain('Read-Only');
    expect(html).not.toContain('Save');
  });
});

describe('EmployeeNoteHistoryModal component', () => {
  const employee: EmployeeNoteListItem = {
    userId: 'user-1',
    name: 'Siddhartha Banerjee',
    email: 'siddhartha@example.com',
    department: 'Engineering',
    designation: 'Developer',
    hasNote: true,
    lastUpdatedAt: '2026-09-29T10:00:00Z',
  };

  it('renders revision snapshots list with preview snippets', () => {
    const history: readonly MyNotepadHistoryItem[] = [
      {
        id: 'h-1',
        organizationId: 'org-1',
        userId: 'user-1',
        content: 'Meeting with senior developer regarding architecture.',
        createdAt: '2026-09-29T09:00:00Z',
      },
      {
        id: 'h-2',
        organizationId: 'org-1',
        userId: 'user-1',
        content: 'Prepare sprint retrospective report.',
        createdAt: '2026-09-28T16:00:00Z',
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(EmployeeNoteHistoryModal, {
        employee,
        history,
        loading: false,
        error: null,
        onClose: () => {},
      }),
    );

    expect(html).toContain("Siddhartha Banerjee&#x27;s Revision History");
    expect(html).toContain('Meeting with senior developer');
    expect(html).toContain('Prepare sprint retrospective report');
    expect(html).toContain('View Snapshot');
    expect(html).not.toContain('Restore');
    expect(html).not.toContain('Delete');
  });

  it('displays empty state when employee has no note history', () => {
    const html = renderToStaticMarkup(
      React.createElement(EmployeeNoteHistoryModal, {
        employee,
        history: [],
        loading: false,
        error: null,
        onClose: () => {},
      }),
    );

    expect(html).toContain('No revision history found.');
  });
});

describe('Super Admin Navigation for Employee Notes', () => {
  it('registers Employee Notes under People with requiredAction notepad:view-all', async () => {
    const { companyNavigation } = await import('../layout/navigation.js');
    const peopleGroup = companyNavigation.find((g) => g.label === 'People');
    expect(peopleGroup).toBeDefined();

    const employeeNotesItem = peopleGroup?.items.find((i) => i.label === 'Employee Notes');
    expect(employeeNotesItem).toBeDefined();
    expect(employeeNotesItem?.path).toBe('/company/employee-notes');
    expect(employeeNotesItem?.icon).toBe('notepad');
    expect(employeeNotesItem?.requiredAction).toBe('notepad:view-all');
  });

  it('displays Employee Notes in CompanySidebar only for super-admin, not for employees or HR', async () => {
    const { CompanySidebar } = await import('../layout/CompanySidebar.js');

    // Global mock for ThemeContext in Node
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: () => 'dark',
        setItem: () => {},
      },
      matchMedia: () => ({ matches: false }),
    };

    const { ThemeProvider } = await import('../../theme/ThemeContext.js');

    // 1. Super Admin: should contain Employee Notes
    const superAdminHtml = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          pathname: '/company/dashboard',
          identity: {
            fullName: 'Admin User',
            email: 'admin@example.com',
          },
          organizationName: 'Acme Corp',
          accountType: 'super-admin',
          canRequestRoleChange: false,
          canViewAudit: true,
          canViewEmployees: true,
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
    expect(superAdminHtml).toContain('Employee Notes');

    // 2. Regular Employee: must NOT contain Employee Notes
    const employeeHtml = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          pathname: '/company/dashboard',
          identity: {
            fullName: 'Normal User',
            email: 'user@example.com',
            departmentCode: 'ENG',
            departmentName: 'Engineering',
          },
          organizationName: 'Acme Corp',
          accountType: 'employee',
          canRequestRoleChange: false,
          canViewAudit: false,
          canViewEmployees: true,
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
    expect(employeeHtml).not.toContain('Employee Notes');

    // 3. HR Employee: must NOT contain Employee Notes
    const hrHtml = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          pathname: '/company/dashboard',
          identity: {
            fullName: 'HR User',
            email: 'hr@example.com',
            departmentCode: 'HR',
            departmentName: 'Human Resources',
          },
          organizationName: 'Acme Corp',
          accountType: 'employee',
          canRequestRoleChange: false,
          canViewAudit: false,
          canViewEmployees: true,
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
    expect(hrHtml).not.toContain('Employee Notes');
  });
});
