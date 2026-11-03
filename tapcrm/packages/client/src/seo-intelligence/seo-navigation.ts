export const SEO_TABS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: 'grid',
    sections: [{ id: 'overview', label: 'Overview' }],
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
