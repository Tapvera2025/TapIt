import { useEffect, useState } from 'react';
import { Card, Empty, Loading, Notice } from '../../ui/components.js';
import { getPortalProjectBlogReport, type PortalBlogPost, type PortalBlogReport } from '../api/portalApi.js';
import { ReportKpiCard } from '../../projects/reports/components/ReportKpiCard.js';
import { Pager } from '../../projects/reports/components/Pager.js';

type BlogStatus = 'all' | 'draft' | 'published' | 'archived';

const statusClass: Record<Exclude<BlogStatus, 'all'>, string> = {
  published: 'bg-emerald-500/10 text-emerald-600',
  draft: 'bg-amber-500/10 text-amber-600',
  archived: 'bg-red-500/10 text-red-600',
};

export function ClientProjectBlogs({ projectId }: { projectId: string }): React.JSX.Element {
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [status, setStatus] = useState<BlogStatus>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<PortalBlogReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    void getPortalProjectBlogReport(projectId, {
      period,
      blogSearch: search.trim() || undefined,
      blogStatus: status,
      blogPage: page,
    }).then((next) => {
      if (live) { setReport(next); setError(''); }
    }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : 'Unable to load blog updates.');
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [page, period, projectId, search, status]);

  const changeStatus = (next: BlogStatus) => { setStatus(next); setPage(1); };
  const changeSearch = (next: string) => { setSearch(next); setPage(1); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">Content preview</p>
          <h2 className="mt-1 font-display text-xl font-bold">Blog updates</h2>
          <p className="mt-1 text-sm text-app-muted">Review the content published and planned for this project.</p>
        </div>
        <label className="text-xs font-semibold text-app-muted">
          Reporting period
          <select value={period} onChange={(event) => { setPeriod(Number(event.target.value) as 7 | 30 | 90); setPage(1); }} className="ml-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-foreground">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
      </div>

      {error && <Notice error>{error}</Notice>}
      {report && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <ReportKpiCard label="Total blogs" value={report.overview.totalBlogs} active={status === 'all'} onClick={() => changeStatus('all')} />
        <ReportKpiCard label="Published" value={report.overview.publishedBlogs} tone="positive" active={status === 'published'} onClick={() => changeStatus('published')} />
        <ReportKpiCard label="Draft" value={report.overview.draftBlogs} tone="warning" active={status === 'draft'} onClick={() => changeStatus('draft')} />
        <ReportKpiCard label="Archived" value={report.overview.archivedBlogs} tone="negative" active={status === 'archived'} onClick={() => changeStatus('archived')} />
      </div>}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold">Blog register</h3>
            <p className="mt-1 text-xs text-app-muted">Read-only project content preview.</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <input value={search} onChange={(event) => changeSearch(event.target.value)} placeholder="Search blog posts or keywords" className="min-w-0 flex-1 rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm sm:min-w-64" />
            <select value={status} onChange={(event) => changeStatus(event.target.value as BlogStatus)} className="rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm">
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        {loading && !report ? <Loading /> : report && <BlogPreviewTable items={report.blogs.items} />}
        {report && report.blogs.total > 0 && <Pager page={report.blogs.page} totalPages={report.blogs.totalPages} onChange={setPage} />}
      </Card>
    </div>
  );
}

function BlogPreviewTable({ items }: { items: readonly PortalBlogPost[] }): React.JSX.Element {
  if (items.length === 0) return <Empty>No blog posts match this report.</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border border-app-border">
      <table className="min-w-[760px] w-full text-left text-sm">
        <thead className="bg-app-surface-raised text-xs uppercase tracking-wide text-app-muted">
          <tr>{['Title', 'Category', 'Target keywords', 'Words', 'Status', 'Publish date'].map((label) => <th key={label} className="border-b border-app-border px-4 py-3 font-bold">{label}</th>)}</tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id} className={`${index % 2 ? 'bg-app-background/40' : ''} border-b border-app-border last:border-b-0`}>
              <td className="max-w-72 px-4 py-3 align-top font-semibold">
                <span className="block break-words">{item.title}</span>
                {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs font-normal text-app-accent hover:underline">View article</a>}
                {item.description && <span className="mt-1 block line-clamp-2 text-xs font-normal text-app-muted">{item.description}</span>}
              </td>
              <td className="whitespace-nowrap px-4 py-3 capitalize">{item.category.replaceAll('-', ' ')}</td>
              <td className="max-w-56 px-4 py-3 align-top">{item.targetKeywords.length === 0 ? <span className="text-xs text-app-muted">—</span> : <div className="flex flex-wrap gap-1.5">{item.targetKeywords.map((keyword) => <span key={keyword} className="max-w-full truncate rounded-full bg-app-accent/10 px-2 py-1 text-[11px] font-semibold text-app-accent">{keyword}</span>)}</div>}</td>
              <td className="whitespace-nowrap px-4 py-3">{item.wordCount.toLocaleString()}</td>
              <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusClass[item.status]}`}>{item.status}</span></td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-app-muted">{item.publishDate ? new Date(item.publishDate).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
