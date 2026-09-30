import type { CompanyDepartment } from '../../../api/companyApi.js';

export function EmployeeNotesFilters({
  departments,
  selectedDepartment,
  onSelectDepartment,
  search,
  onSearchChange,
  onClearFilters,
  disabled = false,
}: {
  departments: readonly CompanyDepartment[];
  selectedDepartment: string;
  onSelectDepartment: (dept: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onClearFilters: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const hasActiveFilters = Boolean(selectedDepartment || search.trim());

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-app-border bg-app-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        {/* Department Filter */}
        <div className="w-full sm:w-64">
          <label htmlFor="dept-filter-select" className="sr-only">
            Filter by Department
          </label>
          <select
            id="dept-filter-select"
            value={selectedDepartment}
            disabled={disabled}
            onChange={(e) => onSelectDepartment(e.target.value)}
            className="w-full rounded-xl border border-app-border bg-app-background px-3.5 py-2.5 text-sm text-app-foreground outline-none transition focus:border-app-accent disabled:opacity-50"
          >
            <option value="">All Departments</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.name}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>

        {/* Employee Search */}
        <div className="relative w-full sm:w-80">
          <label htmlFor="employee-search-input" className="sr-only">
            Search employees
          </label>
          <input
            id="employee-search-input"
            type="text"
            value={search}
            disabled={disabled}
            placeholder="Search employee by name or email…"
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-xl border border-app-border bg-app-background px-3.5 py-2.5 text-sm text-app-foreground placeholder:text-app-muted outline-none transition focus:border-app-accent disabled:opacity-50"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-app-muted hover:text-app-foreground"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Clear Filters Button */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="self-start rounded-xl px-3 py-2 text-xs font-semibold text-app-muted transition hover:bg-app-background hover:text-app-foreground sm:self-center"
        >
          Reset Filters
        </button>
      )}
    </div>
  );
}
