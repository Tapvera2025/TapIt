import { useState } from 'react';
import { Button, Card, Modal, Notice } from '../ui/index.js';
import { Icon } from '../ui/index.js';
import type { Project } from '../projects/api/projectsApi.js';
import { downloadProjectReport } from '../projects/reports/api/projectReportsApi.js';
import { OffPageSeoPage } from '../projects/reports/OffPageSeoPage.js';
import { ProjectBlogUpdates, ProjectKeywordTracker } from '../projects/reports/ProjectSeoSections.js';
import type { ReportPeriod } from '../projects/reports/types.js';
import { SeoProjectPicker } from './SeoProjectPicker.js';
import { SeoEmptyState, SeoSectionHeader } from './SeoUi.js';

export type SeoProjectSection = 'project-keywords' | 'project-blogs' | 'project-backlinks';

/**
 * The Projects area of the SEO dashboard: one project's keywords and rankings,
 * blog links, and backlinks / off-page SEO — the SEO records that used to sit
 * in each project's Reports tab.
 */
export function SeoProjectsPanel({
  section,
  project,
  onProjectChange,
  canManage,
  canView,
}: {
  section: SeoProjectSection;
  project: Project | null;
  onProjectChange: (project: Project) => void;
  /** projects:manage — add, edit and check; the server still checks each project. */
  canManage: boolean;
  /** projects:view — without it there is nothing to show. */
  canView: boolean;
}): React.JSX.Element {
  const [picking, setPicking] = useState(false);
  const [period, setPeriod] = useState<ReportPeriod>(30);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  if (!canView)
    return (
      <div className="seo-panel">
        <SeoEmptyState
          title="Projects aren’t available for your role"
          description="Ask an administrator for access to projects to see their keywords, blog links and backlinks here."
        />
      </div>
    );

  async function download(current: Project): Promise<void> {
    setDownloading(true);
    setError('');
    try {
      const blob = await downloadProjectReport(current.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${current.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project'}-report.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to download the project report.');
    } finally {
      setDownloading(false);
    }
  }

  const titles: Record<SeoProjectSection, { title: string; description: string }> = {
    'project-keywords': {
      title: 'Keywords & rankings',
      description: 'The keywords you track for a project, where they rank, and live checks of their Google position.',
    },
    'project-blogs': {
      title: 'Blog links',
      description: 'Blog posts and articles written for a project, with the keywords each one targets.',
    },
    'project-backlinks': {
      title: 'Backlinks & off-page SEO',
      description: 'Links to the project’s website from other sites, kept as the off-page SEO record.',
    },
  };

  return (
    <div className="seo-panel">
      <SeoSectionHeader eyebrow="Projects" title={titles[section].title} description={titles[section].description} />
      {!project ? (
        <Card>
          <h3 className="font-display text-lg font-bold">Choose a project</h3>
          <p className="mb-4 mt-1 text-sm text-app-muted">Pick the project whose SEO work you want to see.</p>
          <SeoProjectPicker value={null} onChange={onProjectChange} />
        </Card>
      ) : (
        <>
          <div className="seo-surface flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
                <Icon name="briefcase" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{project.name}</p>
                <p className="truncate text-xs text-app-muted">{project.businessName || project.clientName}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-app-muted">
                <span className="sr-only">Reporting period</span>
                <select
                  value={period}
                  onChange={(event) => setPeriod(Number(event.target.value) as ReportPeriod)}
                  className="seo-field text-xs"
                  aria-label="Reporting period"
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
              </label>
              <Button kind="secondary" onClick={() => setPicking(true)}>Change project</Button>
              <Button kind="secondary" disabled={downloading} onClick={() => void download(project)}>
                <Icon name="download" className="mr-1.5 inline size-4" />
                {downloading ? 'Preparing…' : 'Download report'}
              </Button>
            </div>
          </div>
          {error && <Notice error>{error}</Notice>}
          {section === 'project-keywords' && <ProjectKeywordTracker key={project.id} project={project} period={period} canManage={canManage} />}
          {section === 'project-blogs' && <ProjectBlogUpdates key={project.id} project={project} period={period} canManage={canManage} />}
          {section === 'project-backlinks' && <OffPageSeoPage key={project.id} project={project} period={period} />}
        </>
      )}
      {picking && (
        <Modal title="Choose a project" onClose={() => setPicking(false)} dirty={false}>
          <SeoProjectPicker
            value={project}
            autoFocus
            onChange={(next) => {
              onProjectChange(next);
              setPicking(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
