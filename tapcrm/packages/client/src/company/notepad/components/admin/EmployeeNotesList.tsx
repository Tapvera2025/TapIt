import type { EmployeeNoteListItem } from '../../types/index.js';
import { formatHistoryTimestamp } from '../NoteHistoryModal.js';

export function EmployeeNotesList({
  items,
  total,
  page,
  limit,
  onPageChange,
  onSelectEmployee,
  selectedUserId,
  hasActiveFilters,
}: {
  items: readonly EmployeeNoteListItem[];
  total: number; // count
  page: number;
  limit: number;
  onPageChange: (newPage: number) => void;
  onSelectEmployee: (item: EmployeeNoteListItem) => void;
  selectedUserId?: string | null | undefined;
  hasActiveFilters: boolean;
}): React.JSX.Element {
  const totalPages = Math.ceil(total / limit) || 1;
  const startItem = total === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-app-border bg-app-surface p-10 text-center">
        <p className="font-semibold text-app-foreground">
          {hasActiveFilters
            ? 'No employees match your search or filter.'
            : 'No employees found.'}
        </p>
        <p className="mt-1 text-sm text-app-muted">
          {hasActiveFilters
            ? 'Try changing or clearing your search criteria or department filter.'
            : 'There are currently no active employee records in this organization.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Desktop & Tablet Table View */}
      <div className="hidden overflow-hidden rounded-2xl border border-app-border bg-app-surface md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-app-border bg-app-background/60 text-xs font-bold uppercase tracking-wider text-app-muted">
            <tr>
              <th scope="col" className="px-5 py-3.5">
                Employee
              </th>
              <th scope="col" className="px-5 py-3.5">
                Department
              </th>
              <th scope="col" className="px-5 py-3.5">
                Designation
              </th>
              <th scope="col" className="px-5 py-3.5">
                Note Status
              </th>
              <th scope="col" className="px-5 py-3.5">
                Last Updated
              </th>
              <th scope="col" className="px-5 py-3.5 text-right">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {items.map((employee) => {
              const isSelected = selectedUserId === employee.userId;
              return (
                <tr
                  key={employee.userId}
                  className={`transition hover:bg-app-background/50 ${isSelected ? 'bg-app-accent/5' : ''}`}
                >
                  <td className="px-5 py-4">
                    <p className="font-semibold text-app-foreground">{employee.name}</p>
                    <p className="text-xs text-app-muted">{employee.email}</p>
                  </td>
                  <td className="px-5 py-4 text-app-foreground">
                    {employee.department ?? '—'}
                  </td>
                  <td className="px-5 py-4 text-app-foreground">
                    {employee.designation ?? '—'}
                  </td>
                  <td className="px-5 py-4">
                    {employee.hasNote ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-500">
                        Has Note
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-app-border bg-app-background px-2.5 py-0.5 text-xs font-semibold text-app-muted">
                        No Note
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-xs text-app-muted">
                    {employee.lastUpdatedAt ? formatHistoryTimestamp(employee.lastUpdatedAt) : '—'}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => onSelectEmployee(employee)}
                      className="rounded-lg border border-app-border bg-app-background px-3 py-1.5 text-xs font-bold text-app-foreground transition hover:border-app-accent hover:bg-app-accent hover:text-app-on-accent"
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="space-y-3 md:hidden">
        {items.map((employee) => {
          const isSelected = selectedUserId === employee.userId;
          return (
            <div
              key={employee.userId}
              className={`rounded-2xl border border-app-border bg-app-surface p-4 transition ${isSelected ? 'ring-2 ring-app-accent' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-app-foreground">{employee.name}</p>
                  <p className="text-xs text-app-muted">{employee.email}</p>
                </div>
                {employee.hasNote ? (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-500">
                    Has Note
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-app-border bg-app-background px-2 py-0.5 text-xs font-semibold text-app-muted">
                    No Note
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-app-muted">Department:</span>{' '}
                  <span className="font-medium text-app-foreground">
                    {employee.department ?? '—'}
                  </span>
                </div>
                <div>
                  <span className="text-app-muted">Designation:</span>{' '}
                  <span className="font-medium text-app-foreground">
                    {employee.designation ?? '—'}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-app-muted">Last Updated:</span>{' '}
                  <span className="font-medium text-app-foreground">
                    {employee.lastUpdatedAt ? formatHistoryTimestamp(employee.lastUpdatedAt) : '—'}
                  </span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-app-border">
                <button
                  type="button"
                  onClick={() => onSelectEmployee(employee)}
                  className="w-full rounded-xl border border-app-border bg-app-background py-2 text-center text-xs font-bold text-app-foreground transition hover:border-app-accent hover:bg-app-accent hover:text-app-on-accent"
                >
                  View Note
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-app-border bg-app-surface px-5 py-3.5 sm:flex-row">
          <p className="text-xs text-app-muted">
            Showing <span className="font-semibold text-app-foreground">{startItem}</span> to{' '}
            <span className="font-semibold text-app-foreground">{endItem}</span> of{' '}
            <span className="font-semibold text-app-foreground">{total}</span> employees
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="rounded-lg border border-app-border bg-app-background px-3 py-1.5 text-xs font-semibold text-app-foreground transition hover:border-app-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs font-medium text-app-muted">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="rounded-lg border border-app-border bg-app-background px-3 py-1.5 text-xs font-semibold text-app-foreground transition hover:border-app-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
