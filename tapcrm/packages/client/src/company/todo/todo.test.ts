import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'react-hot-toast';
import * as authApi from '../../identity/api/authApi.js';
import {
  companyNavigation,
  myTodoItem,
  myTodoNavItem,
} from '../layout/navigation.js';
import {
  completeTodo,
  createTodo,
  deleteTodo,
  getTodoById,
  listTodos,
  reopenTodo,
  updateTodo,
} from './api/todoApi.js';
import { AddTodoModal } from './components/AddTodoModal.js';
import { DeleteTodoModal } from './components/DeleteTodoModal.js';
import { TodoCard } from './components/TodoCard.js';
import { TodoFilters } from './components/TodoFilters.js';
import { TodoHeader } from './components/TodoHeader.js';
import { TodoSection } from './components/TodoSection.js';
import { TodoStats } from './components/TodoStats.js';
import { TodoProgress } from './components/TodoProgress.js';
import type { MyTodo, TodoPriority } from './types/index.js';

describe('My Todo - Frontend Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockSampleTodo: MyTodo = {
    id: 'todo-101',
    organizationId: 'org-test',
    userId: 'user-test',
    title: 'Review quarterly goals',
    description: 'Prepare notes for executive sync',
    priority: 'high',
    scheduledDate: '2026-09-30',
    dueTime: '15:30:00',
    status: 'pending',
    completedAt: null,
    createdAt: '2026-09-30T07:00:00Z',
    updatedAt: '2026-09-30T07:00:00Z',
  };

  const mockCompletedTodo: MyTodo = {
    id: 'todo-102',
    organizationId: 'org-test',
    userId: 'user-test',
    title: 'Submit daily timesheet',
    description: null,
    priority: 'low',
    scheduledDate: '2026-09-29',
    dueTime: null,
    status: 'completed',
    completedAt: '2026-09-29T18:00:00Z',
    createdAt: '2026-09-29T08:00:00Z',
    updatedAt: '2026-09-29T18:00:00Z',
  };

  describe('1. API Integration (todoApi)', () => {
    it('listTodos calls GET /api/my-todo with no-cache headers and query parameters', async () => {
      const spy = vi
        .spyOn(authApi, 'identityRequest')
        .mockResolvedValue([mockSampleTodo]);

      const result = await listTodos({
        search: 'quarterly',
        priority: 'high',
        status: 'pending',
        scheduledDate: '2026-09-30',
      });

      expect(spy).toHaveBeenCalledWith(
        '/api/my-todo?status=pending&priority=high&search=quarterly&scheduledDate=2026-09-30',
        expect.objectContaining({
          method: 'GET',
          cache: 'no-store',
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('todo-101');
    });

    it('getTodoById calls GET /api/my-todo/:id with encoded id', async () => {
      const spy = vi
        .spyOn(authApi, 'identityRequest')
        .mockResolvedValue(mockSampleTodo);

      const result = await getTodoById('todo-101');

      expect(spy).toHaveBeenCalledWith(
        '/api/my-todo/todo-101',
        expect.objectContaining({
          method: 'GET',
          cache: 'no-store',
        }),
      );
      expect(result.title).toBe('Review quarterly goals');
    });

    it('createTodo calls POST /api/my-todo with payload', async () => {
      const payload = {
        title: 'New Todo Task',
        description: 'Details here',
        priority: 'medium' as TodoPriority,
        scheduledDate: '2026-10-01',
        dueTime: '10:00:00',
      };

      const spy = vi
        .spyOn(authApi, 'identityRequest')
        .mockResolvedValue({ ...mockSampleTodo, ...payload });

      const result = await createTodo(payload);

      expect(spy).toHaveBeenCalledWith(
        '/api/my-todo',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      );
      expect(result.title).toBe('New Todo Task');
    });

    it('updateTodo calls PATCH /api/my-todo/:id with payload', async () => {
      const payload = {
        title: 'Updated title',
        priority: 'low' as TodoPriority,
      };

      const spy = vi
        .spyOn(authApi, 'identityRequest')
        .mockResolvedValue({ ...mockSampleTodo, ...payload });

      const result = await updateTodo('todo-101', payload);

      expect(spy).toHaveBeenCalledWith(
        '/api/my-todo/todo-101',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      );
      expect(result.title).toBe('Updated title');
    });

    it('deleteTodo calls DELETE /api/my-todo/:id', async () => {
      const spy = vi
        .spyOn(authApi, 'identityRequest')
        .mockResolvedValue({ success: true, id: 'todo-101' });

      const result = await deleteTodo('todo-101');

      expect(spy).toHaveBeenCalledWith(
        '/api/my-todo/todo-101',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
      expect(result.success).toBe(true);
    });

    it('completeTodo calls POST /api/my-todo/:id/complete', async () => {
      const spy = vi
        .spyOn(authApi, 'identityRequest')
        .mockResolvedValue({ ...mockSampleTodo, status: 'completed' });

      const result = await completeTodo('todo-101');

      expect(spy).toHaveBeenCalledWith(
        '/api/my-todo/todo-101/complete',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(result.status).toBe('completed');
    });

    it('reopenTodo calls POST /api/my-todo/:id/reopen', async () => {
      const spy = vi
        .spyOn(authApi, 'identityRequest')
        .mockResolvedValue({ ...mockCompletedTodo, status: 'pending' });

      const result = await reopenTodo('todo-102');

      expect(spy).toHaveBeenCalledWith(
        '/api/my-todo/todo-102/reopen',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(result.status).toBe('pending');
    });
  });

  describe('2. Component Rendering & UI Elements', () => {
    it('TodoHeader renders title, eyebrow, and actions', () => {
      const html = renderToStaticMarkup(
        React.createElement(TodoHeader, {
          onAddTodo: () => {},
        }),
      );

      expect(html).toContain('PERSONAL PLANNING');
      expect(html).toContain('My Todo');
      expect(html).toContain('Your personal Todo workspace');
      expect(html).toContain('Add Todo');
      expect(html.toLowerCase()).not.toContain('local time');
    });

    it('TodoStats renders Total, Completed, Today, Upcoming counts with NO productivity panel', () => {
      const html = renderToStaticMarkup(
        React.createElement(TodoStats, {
          totalCount: 15,
          completedCount: 6,
          todayCount: 4,
          upcomingCount: 5,
        }),
      );

      expect(html).toContain('Total Todos');
      expect(html).toContain('15');
      expect(html).toContain('Completed');
      expect(html).toContain('6');
      expect(html).toContain('Today');
      expect(html).toContain('4');
      expect(html).toContain('Upcoming');
      expect(html).toContain('5');

      // Strict check: Productivity section is NOT rendered
      expect(html.toLowerCase()).not.toContain('productivity');
      expect(html.toLowerCase()).not.toContain('streak');
      expect(html.toLowerCase()).not.toContain('analytics');

      // 5th card: Progress is rendered in the unified row
      expect(html).toContain('Progress');
      expect(html).toContain('40%');
      expect(html).toContain('aria-valuenow="40"');
    });

    it('TodoProgress renders compact card layout with percentage, label, icon, and thin bar', () => {
      const html = renderToStaticMarkup(
        React.createElement(TodoProgress, {
          totalCount: 12,
          completedCount: 5,
        }),
      );

      // Percentage and Progress label
      expect(html).toContain('42%');
      expect(html).toContain('Progress');
      // Thin progress bar
      expect(html).toContain('h-1.5 w-full overflow-hidden rounded-full bg-app-border/60');
      expect(html).toContain('width:42%');
      // Compact card styling matching other cards
      expect(html).toContain('p-2.5 sm:p-3');
      expect(html).toContain('col-span-2 lg:col-span-1');
    });

    it('TodoProgress renders zero state safely with 0% and 0 of 0 tasks completed', () => {
      const html = renderToStaticMarkup(
        React.createElement(TodoProgress, {
          totalCount: 0,
          completedCount: 0,
        }),
      );

      expect(html).toContain('Progress');
      expect(html).toContain('Overall completion');
      expect(html).toContain('0%');
      expect(html).toContain('0 of 0 tasks completed');
      expect(html).toContain('aria-valuenow="0"');
      expect(html).toContain('width:0%');
      expect(html.toLowerCase()).not.toContain('nan');
      expect(html.toLowerCase()).not.toContain('infinity');
    });

    it('TodoProgress calculates correct percentage and tasks completed text reactively', () => {
      // Initial: 1 of 4 completed (25%)
      const htmlInitial = renderToStaticMarkup(
        React.createElement(TodoProgress, {
          totalCount: 4,
          completedCount: 1,
        }),
      );
      expect(htmlInitial).toContain('25%');
      expect(htmlInitial).toContain('1 of 4 tasks completed');
      expect(htmlInitial).toContain('aria-valuenow="25"');
      expect(htmlInitial).toContain('width:25%');

      // After completing one Todo: 2 of 4 completed (50%)
      const htmlCompleted = renderToStaticMarkup(
        React.createElement(TodoProgress, {
          totalCount: 4,
          completedCount: 2,
        }),
      );
      expect(htmlCompleted).toContain('50%');
      expect(htmlCompleted).toContain('2 of 4 tasks completed');
      expect(htmlCompleted).toContain('aria-valuenow="50"');
      expect(htmlCompleted).toContain('width:50%');

      // After reopening it: 1 of 4 completed (25%)
      const htmlReopened = renderToStaticMarkup(
        React.createElement(TodoProgress, {
          totalCount: 4,
          completedCount: 1,
        }),
      );
      expect(htmlReopened).toContain('25%');
      expect(htmlReopened).toContain('1 of 4 tasks completed');

      // 2 of 3 completed (67% rounded)
      const htmlTwoThirds = renderToStaticMarkup(
        React.createElement(TodoProgress, {
          totalCount: 3,
          completedCount: 2,
        }),
      );
      expect(htmlTwoThirds).toContain('67%');
      expect(htmlTwoThirds).toContain('2 of 3 tasks completed');
    });

    it('TodoProgress clamps percentage safely between 0% and 100%', () => {
      const htmlOverflow = renderToStaticMarkup(
        React.createElement(TodoProgress, {
          totalCount: 5,
          completedCount: 10,
        }),
      );
      expect(htmlOverflow).toContain('100%');
      expect(htmlOverflow).toContain('aria-valuenow="100"');
      expect(htmlOverflow).toContain('width:100%');

      const htmlNegative = renderToStaticMarkup(
        React.createElement(TodoProgress, {
          totalCount: 5,
          completedCount: -3,
        }),
      );
      expect(htmlNegative).toContain('0%');
      expect(htmlNegative).toContain('aria-valuenow="0"');
      expect(htmlNegative).toContain('width:0%');
    });

    it('TodoProgress strictly avoids any productivity metrics, streaks, or charts', () => {
      const html = renderToStaticMarkup(
        React.createElement(TodoProgress, {
          totalCount: 6,
          completedCount: 4,
        }),
      );
      expect(html.toLowerCase()).not.toContain('productivity');
      expect(html.toLowerCase()).not.toContain('streak');
      expect(html.toLowerCase()).not.toContain('analytics');
      expect(html.toLowerCase()).not.toContain('chart');
    });

    it('TodoFilters renders tabs, search input, and priority options', () => {
      const html = renderToStaticMarkup(
        React.createElement(TodoFilters, {
          search: 'prepare',
          onSearchChange: () => {},
          priority: 'all',
          onPriorityChange: () => {},
          activeTab: 'all',
          onTabChange: () => {},
        }),
      );

      expect(html).toContain('All');
      expect(html).toContain('Today');
      expect(html).toContain('Upcoming');
      expect(html).toContain('Completed');
      expect(html).toContain('Search todos...');
      expect(html).toContain('prepare');
      expect(html).toContain('All priorities');
      expect(html).toContain('High priority');
      expect(html).toContain('Medium priority');
      expect(html).toContain('Low priority');
    });

    it('TodoCard renders pending todo with title, description, priority badge, and actions', () => {
      const html = renderToStaticMarkup(
        React.createElement(TodoCard, {
          todo: mockSampleTodo,
          onComplete: () => {},
          onReopen: () => {},
          onEdit: () => {},
          onDelete: () => {},
        }),
      );

      expect(html).toContain('Review quarterly goals');
      expect(html).toContain('Prepare notes for executive sync');
      expect(html).toContain('high');
      expect(html).toContain('2026-09-30');
      expect(html).toContain('Due 15:30');
      expect(html).toContain('Edit');
      expect(html).toContain('Delete');
      expect(html).not.toContain('line-through');
    });

    it('TodoCard renders completed todo with line-through styling', () => {
      const html = renderToStaticMarkup(
        React.createElement(TodoCard, {
          todo: mockCompletedTodo,
          onComplete: () => {},
          onReopen: () => {},
          onEdit: () => {},
          onDelete: () => {},
        }),
      );

      expect(html).toContain('Submit daily timesheet');
      expect(html).toContain('line-through');
      expect(html).toContain('low');
    });

    it('TodoSection renders section header and empty message when empty', () => {
      const html = renderToStaticMarkup(
        React.createElement(
          TodoSection,
          {
            title: 'Upcoming',
            count: 0,
            emptyMessage: 'No upcoming tasks.',
          },
          null,
        ),
      );

      expect(html).toContain('Upcoming');
      expect(html).toContain('>0<');
      expect(html).toContain('No upcoming tasks.');
    });

    it('AddTodoModal renders dialog with fields when open', () => {
      const html = renderToStaticMarkup(
        React.createElement(AddTodoModal, {
          isOpen: true,
          onClose: () => {},
          onSubmit: async () => {},
          initialTodo: null,
          isSubmitting: false,
        }),
      );

      expect(html).toContain('Add New Todo');
      expect(html).toContain('Title *');
      expect(html).toContain('Priority');
      expect(html).toContain('Scheduled Date *');
      expect(html).toContain('Due Time (Optional)');
      expect(html).toContain('Notes (Optional)');
      expect(html).toContain('Cancel');
      expect(html).toContain('Add Todo');
    });

    it('AddTodoModal renders in Edit mode with existing data', () => {
      const html = renderToStaticMarkup(
        React.createElement(AddTodoModal, {
          isOpen: true,
          onClose: () => {},
          onSubmit: async () => {},
          initialTodo: mockSampleTodo,
          isSubmitting: false,
        }),
      );

      expect(html).toContain('Edit Todo');
      expect(html).toContain('Review quarterly goals');
      expect(html).toContain('Prepare notes for executive sync');
      expect(html).toContain('Save Changes');
    });

    it('DeleteTodoModal renders confirmation modal with title and prompt text', () => {
      const html = renderToStaticMarkup(
        React.createElement(DeleteTodoModal, {
          isOpen: true,
          onClose: () => {},
          onConfirm: () => {},
          todoTitle: 'Prepare financial report',
          isDeleting: false,
        }),
      );

      expect(html).toContain('Delete Todo');
      expect(html).toContain('Are you sure want to delete this todo??');
      expect(html).toContain('Prepare financial report');
      expect(html).toContain('Cancel');
      expect(html).toContain('Delete');
    });

    it('DeleteTodoModal returns empty when closed', () => {
      const html = renderToStaticMarkup(
        React.createElement(DeleteTodoModal, {
          isOpen: false,
          onClose: () => {},
          onConfirm: () => {},
          todoTitle: 'Sample',
        }),
      );

      expect(html).toBe('');
    });

    it('DeleteTodoModal indicates deleting status when active', () => {
      const html = renderToStaticMarkup(
        React.createElement(DeleteTodoModal, {
          isOpen: true,
          onClose: () => {},
          onConfirm: () => {},
          isDeleting: true,
        }),
      );

      expect(html).toContain('Deleting...');
    });
  });

  describe('3. Filtering & Grouping Logic', () => {
    const list: MyTodo[] = [
      {
        ...mockSampleTodo,
        id: '1',
        title: 'Alpha task',
        scheduledDate: '2026-09-30',
        status: 'pending',
        priority: 'high',
      },
      {
        ...mockSampleTodo,
        id: '2',
        title: 'Beta task',
        scheduledDate: '2026-10-05',
        status: 'pending',
        priority: 'medium',
      },
      {
        ...mockSampleTodo,
        id: '3',
        title: 'Gamma task',
        scheduledDate: '2026-09-25',
        status: 'completed',
        priority: 'low',
      },
      {
        ...mockSampleTodo,
        id: '4',
        title: 'Delta task without date',
        scheduledDate: null,
        status: 'pending',
        priority: 'low',
      },
    ];

    it('partitions items correctly into Today, Upcoming, and Completed', () => {
      const todayStr = '2026-09-30';

      const todayList: MyTodo[] = [];
      const upcomingList: MyTodo[] = [];
      const completedList: MyTodo[] = [];

      for (const item of list) {
        if (item.status === 'completed') {
          completedList.push(item);
        } else if (item.scheduledDate && item.scheduledDate > todayStr) {
          upcomingList.push(item);
        } else {
          todayList.push(item);
        }
      }

      // Today should contain Alpha (scheduled today) and Delta (no date)
      expect(todayList.map((t) => t.id)).toEqual(['1', '4']);
      // Upcoming should contain Beta (future date)
      expect(upcomingList.map((t) => t.id)).toEqual(['2']);
      // Completed should contain Gamma
      expect(completedList.map((t) => t.id)).toEqual(['3']);
    });

    it('filters correctly by search query matching title or description', () => {
      const query = 'alpha';
      const filtered = list.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          (t.description ?? '').toLowerCase().includes(query),
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.id).toBe('1');
    });

    it('filters correctly by priority', () => {
      const highOnly = list.filter((t) => t.priority === 'high');
      expect(highOnly).toHaveLength(1);
      expect(highOnly[0]?.id).toBe('1');

      const lowOnly = list.filter((t) => t.priority === 'low');
      expect(lowOnly).toHaveLength(2);
    });
  });

  describe('4. Navigation & Universal Access', () => {
    it('registers My Todo in companyNavigation under Overview as universal item with pencil icon', () => {
      expect(myTodoNavItem).toBeDefined();
      expect(myTodoItem).toBe(myTodoNavItem);
      expect(myTodoNavItem.label).toBe('My Todo');
      expect(myTodoNavItem.path).toBe('/company/todo');
      expect(myTodoNavItem.icon).toBe('pencil');
      expect(myTodoNavItem.icon).not.toBe('check');
      expect(myTodoNavItem.icon).not.toBe('notepad');
      expect(myTodoNavItem.requiredAction).toBeUndefined();

      const overview = companyNavigation.find((g) => g.label === 'Overview');
      expect(overview).toBeDefined();

      const tasksItem = overview?.items.find((i) => i.label === 'Tasks');
      expect(tasksItem?.icon).toBe('check');

      const notepadItem = overview?.items.find((i) => i.label === 'My Notepad');
      expect(notepadItem?.icon).toBe('notepad');

      const itemLabels = overview?.items.map((i) => i.label);
      expect(itemLabels).toEqual(['Dashboard', 'Tasks', 'My Todo', 'My Notepad']);
    });

    it('renders My Todo in CompanySidebar for Super Admin, HR, and regular employees', async () => {
      const { CompanySidebar } = await import('../layout/CompanySidebar.js');
      const { ThemeProvider } = await import('../../theme/ThemeContext.js');

      // Minimal window mock for ThemeContext in Node environment
      (globalThis as unknown as { window: unknown }).window = {
        localStorage: {
          getItem: () => 'dark',
          setItem: () => {},
        },
        matchMedia: () => ({ matches: false }),
      };

      const testRoles = [
        { accountType: 'super-admin', isHr: false },
        { accountType: 'employee', isHr: true, dept: 'HR' },
        { accountType: 'employee', isHr: false, dept: 'ENG' },
        { accountType: 'contractor', isHr: false },
      ];

      for (const role of testRoles) {
        const html = renderToStaticMarkup(
          React.createElement(
            ThemeProvider,
            null,
            React.createElement(CompanySidebar, {
              pathname: '/company/todo',
              identity: {
                fullName: 'Test User',
                email: 'test@example.com',
                departmentCode: role.dept ?? null,
                departmentName: role.dept ?? null,
                positionCode: null,
              },
              organizationName: 'Acme Corp',
              accountType: role.accountType,
              canRequestRoleChange: false,
              canViewAudit: false,
              canViewEmployees: false,
              onNavigate: () => {},
              onLogout: () => {},
              open: true,
              onClose: () => {},
            }),
          ),
        );

        expect(html).toContain('Overview');
        expect(html).toContain('My Todo');
        expect(html).toContain('My Notepad');
      }
    });
  });

  describe('5. Mobile Responsiveness & Container Constraints', () => {
    it('uses responsive layout utility classes with no fixed desktop width containers', () => {
      const headerHtml = renderToStaticMarkup(
        React.createElement(TodoHeader, {
          onAddTodo: () => {},
        }),
      );
      expect(headerHtml).toContain('flex flex-col gap-4 sm:flex-row');

      const statsHtml = renderToStaticMarkup(
        React.createElement(TodoStats, {
          totalCount: 3,
          completedCount: 1,
          todayCount: 2,
        }),
      );
      expect(statsHtml).toContain('grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5');

      const filtersHtml = renderToStaticMarkup(
        React.createElement(TodoFilters, {
          search: '',
          onSearchChange: () => {},
          priority: 'all',
          onPriorityChange: () => {},
        }),
      );
      expect(filtersHtml).toContain('flex flex-col gap-3 sm:flex-row');

      const progressHtml = renderToStaticMarkup(
        React.createElement(TodoProgress, {
          totalCount: 3,
          completedCount: 2,
        }),
      );
      expect(progressHtml).toContain('w-full');

      // Verify no hardcoded desktop widths like min-w-[800px] or fixed 1200px
      expect(headerHtml).not.toMatch(/min-w-\[\d+px\]/);
      expect(statsHtml).not.toMatch(/min-w-\[\d+px\]/);
      expect(filtersHtml).not.toMatch(/min-w-\[\d+px\]/);
      expect(progressHtml).not.toMatch(/min-w-\[\d+px\]/);
    });
  });

  describe('6. Toast Notifications Integration', () => {
    it('provides toast.success and toast.error functions from react-hot-toast', () => {
      expect(typeof toast.success).toBe('function');
      expect(typeof toast.error).toBe('function');
    });

    it('triggers success toast upon successful create, update, and delete actions', () => {
      const successSpy = vi.spyOn(toast, 'success');
      toast.success('Todo created successfully');
      expect(successSpy).toHaveBeenCalledWith('Todo created successfully');

      toast.success('Todo updated successfully');
      expect(successSpy).toHaveBeenCalledWith('Todo updated successfully');

      toast.success('Todo deleted successfully');
      expect(successSpy).toHaveBeenCalledWith('Todo deleted successfully');
    });

    it('triggers error toast upon failed create, update, and delete actions', () => {
      const errorSpy = vi.spyOn(toast, 'error');
      toast.error('Failed to create todo.');
      expect(errorSpy).toHaveBeenCalledWith('Failed to create todo.');

      toast.error('Failed to update todo.');
      expect(errorSpy).toHaveBeenCalledWith('Failed to update todo.');

      toast.error('Failed to delete todo.');
      expect(errorSpy).toHaveBeenCalledWith('Failed to delete todo.');
    });
  });
});
