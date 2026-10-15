import { useEffect, useState } from 'react';
import { Icon } from '../../../ui/Icon.js';
import { getCompanyDepartments, type CompanyDepartment } from '../../api/companyApi.js';
import {
  getEmployeeCurrentNote,
  getEmployeeNoteHistory,
  listEmployeeNotes,
} from '../api/notepadApi.js';
import { EmployeeNoteHistoryModal } from '../components/admin/EmployeeNoteHistoryModal.js';
import { EmployeeNoteViewer } from '../components/admin/EmployeeNoteViewer.js';
import { EmployeeNotesFilters } from '../components/admin/EmployeeNotesFilters.js';
import { EmployeeNotesList } from '../components/admin/EmployeeNotesList.js';
import type { EmployeeNoteListItem, MyNotepad, MyNotepadHistoryItem } from '../types/index.js';

export function EmployeeNotesPage(): React.JSX.Element {
  const [departments, setDepartments] = useState<CompanyDepartment[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [employees, setEmployees] = useState<readonly EmployeeNoteListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected employee detail state
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeNoteListItem | null>(null);
  const [selectedNote, setSelectedNote] = useState<MyNotepad | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // History modal state
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [history, setHistory] = useState<readonly MyNotepadHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load department list on mount
  useEffect(() => {
    void getCompanyDepartments()
      .then((deptList) => {
        setDepartments(deptList.filter((d) => d.status === 'active'));
      })
      .catch(() => {
        // Non-blocking: dropdown remains empty if departments fail to load
      });
  }, []);

  // Fetch employee notes list whenever filters change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void listEmployeeNotes({
      department: selectedDepartment || undefined,
      search: debouncedSearch || undefined,
      page,
      limit,
    })
      .then((res) => {
        if (cancelled) return;
        setEmployees(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load employee notes directory.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDepartment, debouncedSearch, page]);

  function handleSelectDepartment(dept: string) {
    setSelectedDepartment(dept);
    setPage(1);
  }

  function handleResetFilters() {
    setSelectedDepartment('');
    setSearch('');
    setDebouncedSearch('');
    setPage(1);
  }

  function handleSelectEmployee(employee: EmployeeNoteListItem) {
    setSelectedEmployee(employee);
    setSelectedNote(null);
    setLoadingNote(true);
    setNoteError(null);

    void getEmployeeCurrentNote(employee.userId)
      .then((note) => {
        setSelectedNote(note);
      })
      .catch((err) => {
        setNoteError(
          err instanceof Error
            ? err.message
            : 'Unable to load employee notepad content.',
        );
      })
      .finally(() => {
        setLoadingNote(false);
      });
  }

  function handleOpenHistory() {
    if (!selectedEmployee) return;
    setShowHistoryModal(true);
    setLoadingHistory(true);
    setHistoryError(null);

    void getEmployeeNoteHistory(selectedEmployee.userId)
      .then((items) => {
        setHistory(items);
      })
      .catch((err) => {
        setHistoryError(
          err instanceof Error
            ? err.message
            : 'Unable to load employee note history.',
        );
      })
      .finally(() => {
        setLoadingHistory(false);
      });
  }

  return (
    <div className="p-5 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="overflow-hidden rounded-2xl border border-app-border bg-app-surface">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-app-accent/10 text-app-accent">
                <Icon name="notepad" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-app-accent">Super Admin Monitoring</p>
                <h1 className="mt-0.5 text-base font-bold text-app-foreground">Employee notes directory</h1>
                <p className="mt-0.5 text-xs text-app-muted">Read-only access to employee notepads and revision history.</p>
              </div>
            </div>
            <span className="text-sm font-semibold text-app-muted">{loading ? 'Loading…' : `${total} employee${total === 1 ? '' : 's'}`}</span>
          </div>
          <div className="border-t border-t-[color:var(--app-border)] px-5 py-3 sm:px-6">
            <EmployeeNotesFilters
              departments={departments}
              selectedDepartment={selectedDepartment}
              onSelectDepartment={handleSelectDepartment}
              search={search}
              onSearchChange={setSearch}
              onClearFilters={handleResetFilters}
              disabled={loading && employees.length === 0}
            />
          </div>
        </section>

        {/* Global Error Banner */}
        {error && (
          <div className="rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 p-4 text-sm text-app-danger">
            {error}
          </div>
        )}

        {/* Loading Skeleton */}
        {loading && employees.length === 0 ? (
          <div className="h-64 animate-pulse rounded-2xl border border-app-border bg-app-surface p-6" />
        ) : (
          <EmployeeNotesList
            items={employees}
            total={total}
            page={page}
            limit={limit}
            onPageChange={setPage}
            onSelectEmployee={handleSelectEmployee}
            selectedUserId={selectedEmployee?.userId}
            hasActiveFilters={Boolean(selectedDepartment || debouncedSearch.trim())}
          />
        )}

        {/* Selected Employee Current Note Viewer Modal */}
        {selectedEmployee && (
          <EmployeeNoteViewer
            employee={selectedEmployee}
            note={selectedNote}
            loading={loadingNote}
            error={noteError}
            onViewHistory={handleOpenHistory}
            onClose={() => {
              setSelectedEmployee(null);
              setSelectedNote(null);
            }}
          />
        )}

        {/* Employee Note Revision History Modal */}
        {showHistoryModal && selectedEmployee && (
          <EmployeeNoteHistoryModal
            employee={selectedEmployee}
            history={history}
            loading={loadingHistory}
            error={historyError}
            onClose={() => {
              setShowHistoryModal(false);
              setHistory([]);
            }}
          />
        )}
      </div>
    </div>
  );
}
