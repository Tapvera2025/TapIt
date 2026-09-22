import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  getCompanyEmployees,
  type CompanyEmployee,
} from '../../api/companyApi.js';
import type { TaskAssigneePickerProps } from '../types/index.js';

export function TaskAssigneePicker({
  selectedAssigneeIds,
  onChange,
  disabled = false,
}: TaskAssigneePickerProps): React.JSX.Element {
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setLoadError(null);
        const data = await getCompanyEmployees();
        if (!cancelled) {
          setEmployees(data);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load employees',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const employeeMap = useMemo(() => {
    const map = new Map<string, CompanyEmployee>();
    for (const emp of employees) {
      map.set(emp.id, emp);
    }
    return map;
  }, [employees]);

  const availableEmployees = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return employees.filter((emp) => {
      if (selectedAssigneeIds.includes(emp.id)) return false;
      if (!term) return true;
      return (
        emp.fullName.toLowerCase().includes(term) ||
        (emp.email && emp.email.toLowerCase().includes(term)) ||
        (emp.departmentName && emp.departmentName.toLowerCase().includes(term))
      );
    });
  }, [employees, selectedAssigneeIds, searchTerm]);

  function handleAdd(id: string) {
    if (!selectedAssigneeIds.includes(id)) {
      onChange([...selectedAssigneeIds, id]);
    }
    setSearchTerm('');
  }

  function handleRemove(id: string) {
    onChange(selectedAssigneeIds.filter((assigneeId) => assigneeId !== id));
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <label className="text-xs font-semibold text-app-muted">
        <span className="mb-2 block">Assign To (Multiple)</span>
      </label>

      {/* Selected Employee Pills */}
      {selectedAssigneeIds.length > 0 && (
        <div
          className="mb-2 flex flex-wrap gap-1.5"
          aria-label="Selected assignees"
        >
          {selectedAssigneeIds.map((id) => {
            const emp = employeeMap.get(id);
            const displayName = emp?.fullName ?? `Employee (${id.slice(0, 8)})`;

            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface-raised px-2.5 py-1 text-xs font-medium text-app-foreground"
              >
                <span>{displayName}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemove(id)}
                    className="grid size-4 place-items-center rounded hover:bg-app-danger/10 hover:text-app-danger"
                    aria-label={`Remove ${displayName}`}
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Search / Selector Input */}
      <div className="relative">
        <input
          type="text"
          disabled={disabled}
          placeholder={
            loading
              ? 'Loading employees...'
              : selectedAssigneeIds.length === 0
                ? 'Type name to search and assign employees...'
                : 'Add another employee...'
          }
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
        />

        {loading && (
          <div className="absolute right-3 top-2.5 text-xs text-app-muted">
            Loading...
          </div>
        )}
      </div>

      {loadError && (
        <p className="mt-1 text-xs text-app-danger" role="alert">
          {loadError}
        </p>
      )}

      {/* Dropdown Options List */}
      {isOpen && !disabled && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-app-border bg-app-surface shadow-lg outline-none"
        >
          {availableEmployees.length === 0 ? (
            <li className="px-3 py-2.5 text-xs text-app-muted">
              {employees.length === 0
                ? 'No employees available in organization'
                : 'No matching unassigned employees'}
            </li>
          ) : (
            availableEmployees.map((emp) => (
              <li
                key={emp.id}
                role="option"
                aria-selected="false"
                tabIndex={0}
                onClick={() => handleAdd(emp.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleAdd(emp.id);
                  }
                }}
                className="cursor-pointer border-b border-app-border/40 px-3 py-2 text-xs transition last:border-b-0 hover:bg-app-accent/10 hover:text-app-accent focus:bg-app-accent/10 focus:text-app-accent"
              >
                <div className="font-semibold text-app-foreground">
                  {emp.fullName}
                </div>
                <div className="text-[11px] text-app-muted">
                  {emp.email ?? emp.positionName ?? 'Employee'}
                  {emp.departmentName ? ` • ${emp.departmentName}` : ''}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
