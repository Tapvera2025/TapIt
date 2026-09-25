import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { getTaskAssignees } from '../api/tasksApi.js';
import type {
  TaskAssignableUser,
  TaskAssigneePickerProps,
} from '../types/index.js';

export function TaskAssigneePicker({
  selectedAssigneeIds,
  onChange,
  disabled = false,
  projectId,
}: TaskAssigneePickerProps): React.JSX.Element {
  const [assignees, setAssignees] = useState<TaskAssignableUser[]>([]);
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
        const data = await getTaskAssignees({ projectId });
        if (!cancelled) {
          setAssignees(data);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load assignees',
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
  }, [projectId]);

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

  const assigneeMap = useMemo(() => {
    const map = new Map<string, TaskAssignableUser>();
    for (const emp of assignees) {
      map.set(emp.id, emp);
    }
    return map;
  }, [assignees]);

  const availableAssignees = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return assignees.filter((emp) => {
      if (selectedAssigneeIds.includes(emp.id)) return false;
      if (!term) return true;
      return (
        emp.fullName.toLowerCase().includes(term) ||
        (emp.email && emp.email.toLowerCase().includes(term)) ||
        (emp.departmentName && emp.departmentName.toLowerCase().includes(term))
      );
    });
  }, [assignees, selectedAssigneeIds, searchTerm]);

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
        <span className="mb-1.5 block">Assign To (Multiple)</span>
      </label>

      {/* Selected Employee Pills */}
      {selectedAssigneeIds.length > 0 && (
        <div
          className="mb-2 flex flex-wrap gap-1"
          aria-label="Selected assignees"
        >
          {selectedAssigneeIds.map((id) => {
            const emp = assigneeMap.get(id);
            const displayName = emp?.fullName ?? `Assignee (${id.slice(0, 8)})`;

            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded border border-app-border bg-app-surface px-2 py-0.5 text-xs text-app-foreground"
              >
                <span>{displayName}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemove(id)}
                    className="grid size-3.5 place-items-center rounded text-app-muted hover:text-app-danger"
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
              ? 'Loading assignees...'
              : selectedAssigneeIds.length === 0
                ? 'Type name to search and assign...'
                : 'Add another assignee...'
          }
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="h-8.5 w-full rounded-md border border-app-border bg-app-background px-3 text-xs text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
        />

        {loading && (
          <div className="absolute right-3 top-2 text-xs text-app-muted">
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
          className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-md border border-app-border bg-app-surface shadow-md outline-none"
        >
          {availableAssignees.length === 0 ? (
            <li className="px-3 py-2 text-xs text-app-muted">
              {loadError
                ? `Error: ${loadError}`
                : assignees.length === 0
                  ? 'No assignable employees found in your scope'
                  : 'No matching unassigned employees'}
            </li>
          ) : (
            availableAssignees.map((emp) => (
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
                className="cursor-pointer border-b border-app-border/30 px-3 py-1.5 text-xs transition last:border-b-0 hover:bg-app-accent/5 hover:text-app-accent focus:bg-app-accent/5 focus:text-app-accent"
              >
                <div className="font-medium text-app-foreground">
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
