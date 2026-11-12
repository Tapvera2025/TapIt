import { useEffect, useState } from 'react';
import { Icon, Notice, SkeletonTable } from '../ui/index.js';
import { getProjects, type Project } from '../projects/api/projectsApi.js';

/**
 * A searchable list of the projects the person can see. Projects are the unit
 * the SEO dashboard's Projects area and "Check an existing project" work on.
 */
export function SeoProjectPicker({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
}: {
  value: Project | null;
  onChange: (project: Project) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const handle = setTimeout(() => {
      void getProjects({ ...(search.trim() ? { search: search.trim() } : {}), pageSize: 25 })
        .then((page) => {
          if (!live) return;
          setProjects(page.items);
          setTotal(page.total);
          setError('');
        })
        .catch((cause: unknown) => {
          if (live) setError(cause instanceof Error ? cause.message : 'Unable to load projects.');
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [search]);
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="sr-only">Search projects</span>
        <input
          type="search"
          className="seo-field w-full"
          placeholder="Search projects by name or client…"
          value={search}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {error && <Notice error>{error}</Notice>}
      {projects === null ? (
        <SkeletonTable columns={1} rows={3} />
      ) : projects.length === 0 ? (
        <p className="py-4 text-center text-sm text-app-muted">
          {search.trim() ? 'No projects match your search.' : 'There are no projects you can open yet.'}
        </p>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1" role="listbox" aria-label="Projects">
          {projects.map((project) => {
            const selected = value?.id === project.id;
            return (
              <button
                key={project.id}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={disabled}
                onClick={() => onChange(project)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${selected ? 'border-app-accent bg-app-accent/5' : 'border-app-border hover:border-app-accent/50'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{project.name}</span>
                  <span className="block truncate text-xs text-app-muted">
                    {project.businessName || project.clientName}
                    {project.workStatus ? ` · ${project.workStatus}` : ''}
                  </span>
                </span>
                {selected ? <Icon name="check" className="size-4 shrink-0 text-app-accent" /> : <Icon name="arrow" className="size-4 shrink-0 text-app-muted" />}
              </button>
            );
          })}
          {total > projects.length && (
            <p className="px-1 pt-1 text-xs text-app-muted">Showing {projects.length} of {total}. Search to narrow the list.</p>
          )}
        </div>
      )}
    </div>
  );
}
