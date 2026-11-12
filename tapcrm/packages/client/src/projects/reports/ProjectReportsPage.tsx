import { useState } from 'react';
import { Button, Card, Notice } from '../../ui/index.js';
import { downloadProjectReport } from './api/projectReportsApi.js';
import { ScreenshotsPage } from './ScreenshotsPage.js';
import type { Project } from '../api/projectsApi.js';

/**
 * A project's Reports tab: the downloadable report and project screenshots.
 *
 * The project's SEO records — keywords and their rankings, blog links and
 * backlinks — are worked on in the SEO dashboard (Projects), so they live in
 * one place with the rest of the SEO work. This page points there.
 */
export function ProjectReportsPage({ project, onOpenSeo }: { project: Project; onOpenSeo?: () => void }): React.JSX.Element {
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function downloadReport(): Promise<void> {
    setDownloading(true);
    setError('');
    try {
      const blob = await downloadProjectReport(project.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project'}-report.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice('Project report downloaded.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to download the project report.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5 p-5 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">Project Reports</p>
          <h2 className="mt-2 font-display text-2xl font-bold">{project.name}</h2>
          <p className="mt-1 text-sm text-app-muted">The project report and screenshots for {project.businessName}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-app-muted">Reporting period</span>
          <select value={period} onChange={(e) => setPeriod(Number(e.target.value) as 7 | 30 | 90)} aria-label="Reporting period" className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <Button kind="primary" onClick={() => { void downloadReport(); }} disabled={downloading}>{downloading ? 'Preparing report…' : 'Download report'}</Button>
        </div>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}
      <Card className="flex flex-wrap items-center justify-between gap-4 border-app-accent/30 bg-app-accent/5">
        <div className="max-w-2xl">
          <h3 className="font-display text-lg font-bold">Keywords, rankings, blog links and backlinks</h3>
          <p className="mt-1 text-sm text-app-muted">
            This project’s SEO work now lives in the SEO dashboard, under Projects: the keyword tracker with live Google
            rankings, blog links, and backlinks / off-page SEO. Nothing was removed — it is all there.
          </p>
        </div>
        {onOpenSeo ? (
          <Button onClick={onOpenSeo}>Open in SEO dashboard</Button>
        ) : (
          <p className="text-xs text-app-muted">Ask an administrator for SEO dashboard access to work on it.</p>
        )}
      </Card>
      <ScreenshotsPage project={project} period={period} />
    </div>
  );
}
