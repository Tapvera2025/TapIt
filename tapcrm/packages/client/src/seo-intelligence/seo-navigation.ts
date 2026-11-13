export const SEO_TABS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: 'grid',
    sections: [{ id: 'overview', label: 'Overview' }],
  },
  {
    id: 'keyword-search',
    label: 'Keyword search',
    icon: 'compass',
    sections: [{ id: 'keyword-search', label: 'Keyword search' }],
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: 'briefcase',
    sections: [
      { id: 'project-keywords', label: 'Keywords & rankings' },
      { id: 'project-blogs', label: 'Blog links' },
      { id: 'project-backlinks', label: 'Backlinks & off-page' },
    ],
  },
  {
    id: 'website',
    label: 'Website health',
    icon: 'shield',
    sections: [
      { id: 'audit', label: 'Issues to review' },
      { id: 'fix-studio', label: 'Recommended fixes' },
      { id: 'performance', label: 'Speed & experience' },
    ],
  },
  {
    id: 'visibility',
    label: 'Search visibility',
    icon: 'search',
    sections: [
      { id: 'search-performance', label: 'Google traffic' },
      { id: 'search-console', label: 'Search Console report' },
      { id: 'keywords', label: 'Search terms' },
      { id: 'rank-tracking', label: 'Google positions' },
      { id: 'ai-visibility', label: 'AI mentions' },
      { id: 'backlinks', label: 'Links to your website' },
    ],
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: 'history',
    sections: [
      { id: 'scans', label: 'Checkup history' },
      { id: 'monitoring', label: 'Notifications' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    sections: [
      { id: 'sites', label: 'Your websites' },
      { id: 'crawl', label: 'Crawl & data sources' },
      { id: 'rules', label: 'Checkup settings' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    icon: 'file-text',
    sections: [
      { id: 'content-board', label: 'Articles & briefs' },
      { id: 'content-brand', label: 'Brand guidance' },
    ],
  },
] as const;
export type SeoSection = (typeof SEO_TABS)[number]['sections'][number]['id'];
/** Areas that do not belong to one website: they work without a website selected. */
export const SITE_INDEPENDENT_SECTIONS: readonly SeoSection[] = [
  'sites',
  'rules',
  'keyword-search',
  'project-keywords',
  'project-blogs',
  'project-backlinks',
];
export function isProjectSection(section: SeoSection): boolean {
  return section === 'project-keywords' || section === 'project-blogs' || section === 'project-backlinks';
}
/** The SEO dashboard area a deep link names: /company/seo-intelligence/<area>[/<id>]. */
export function sectionFromPath(pathname: string): { section: SeoSection; id: string | null } | null {
  const parts = pathname.replace(/^\/company\/seo-intelligence\/?/, '').split('/').filter(Boolean);
  const [area, id] = parts;
  if (!area) return null;
  if (area === 'projects') return { section: 'project-keywords', id: id ?? null };
  if (area === 'keyword-search') return { section: 'keyword-search', id: null };
  if (area === 'search-console') return { section: 'search-console', id: null };
  const known = SEO_TABS.flatMap((tab) => tab.sections.map((item) => item.id as string));
  return known.includes(area) ? { section: area as SeoSection, id: null } : null;
}
export function seoTabForSection(section: SeoSection) {
  return (
    SEO_TABS.find((tab) => tab.sections.some((item) => item.id === section)) ??
    SEO_TABS[0]
  );
}
export function moveTabIndex(current: number, key: string, length: number) {
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === 'ArrowRight') return (current + 1) % length;
  if (key === 'ArrowLeft') return (current - 1 + length) % length;
  return current;
}
