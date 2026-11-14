import { WorkspacePageContainer } from '../../ui/index.js';
import { useCompanyPageMetadataValue, type CompanyPageMetadata } from './CompanyNavbarContext.js';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { CompanyHeroUtilityCapsule } from './CompanyHeroUtilityCapsule.js';

const DESCRIPTION_BY_TITLE: Readonly<Record<string, string>> = {
  Accounting: 'Manage workspace accounts, ledgers and financial records.',
  Clients: 'Manage client relationships, meetings and delivery context.',
  Corrections: 'Review attendance correction requests and decisions.',
  Employees: 'Manage company workforce and employee information.',
  Holidays: 'Review the organization holiday calendar and planned days off.',
  Messages: 'Manage company conversations and communication.',
  Projects: 'Manage company projects and their progress.',
  Tasks: 'Manage and track assigned work.',
  'My Attendance': 'Review your attendance history and work calendar.',
  'My Leave': 'Apply for leave, review requests and check available balances.',
  'My Todo': 'Plan your day, organize upcoming work and stay on track.',
  'My Notepad': 'Keep personal notes and useful workspace information close by.',
  Recruitment: 'Manage recruitment, candidates and employee onboarding.',
  'Sales Overview': 'Monitor sales activity, pipeline progress and team performance.',
};

function categoryForPath(pathname: string): string {
  if (pathname.includes('/recruitment') || pathname.includes('/interviews')) return 'Human resources';
  if (pathname.includes('/organization') || pathname.includes('/employees')) return 'Organization';
  if (pathname.includes('/attendance') || pathname.includes('/leave') || pathname.includes('/shifts') || pathname.includes('/holidays')) return 'People operations';
  if (pathname.includes('/sales')) return 'Sales';
  if (pathname.includes('/payroll') || pathname.includes('/finance')) return 'Finance';
  if (pathname.includes('/projects') || pathname.includes('/clients') || pathname.includes('/meetings')) return 'Company operations';
  if (pathname.includes('/messages')) return 'Communication';
  if (pathname.includes('/todo') || pathname.includes('/tasks') || pathname.includes('/notepad')) return 'Productivity';
  if (pathname.includes('/access') || pathname.includes('/audit') || pathname.includes('/sessions')) return 'Identity & access';
  return 'Company operations';
}

export function defaultCompanyPageMetadata({
  pathname,
  title,
  fullName,
  isSuperAdmin,
}: {
  readonly pathname: string;
  readonly title: string;
  readonly fullName: string;
  readonly isSuperAdmin: boolean;
}): CompanyPageMetadata {
  const isDashboard = pathname === '/company/dashboard';
  const resolvedTitle = isDashboard ? (isSuperAdmin ? 'Admin dashboard' : 'Today at a glance') : title;
  const description = isDashboard
    ? (isSuperAdmin ? 'Workforce, sales and requests in one live view.' : `${fullName}'s operational workboard.`)
    : DESCRIPTION_BY_TITLE[resolvedTitle] ?? `Work with ${resolvedTitle.toLowerCase()} across your company workspace.`;

  return {
    eyebrow: isDashboard ? 'Company operations' : categoryForPath(pathname),
    title: resolvedTitle,
    description,
  };
}

export function CompanyPageHero(): React.JSX.Element {
  const metadata = useCompanyPageMetadataValue();
  const wrapperRef = useRef<HTMLElement>(null);
  const capsuleRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({
    width: 0,
    height: 0,
    capsuleLeft: 0,
    capsuleBottom: 0,
  });
  const gradientId = useId().replace(/:/g, '');
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const capsule = capsuleRef.current;
    if (!wrapper || !capsule) return;
    const update = () => {
      const wrapperBounds = wrapper.getBoundingClientRect();
      const capsuleBounds = capsule.getBoundingClientRect();
      const next = {
        width: wrapper.clientWidth,
        height: wrapper.clientHeight,
        capsuleLeft: capsuleBounds.left - wrapperBounds.left,
        capsuleBottom: capsuleBounds.bottom - wrapperBounds.top,
      };
      setSize((prev) => Object.keys(next).every((key) => prev[key as keyof typeof prev] === next[key as keyof typeof next]) ? prev : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    observer.observe(capsule);
    update();
    return () => observer.disconnect();
  }, []);
  if (!metadata) return <></>;

  const { width: w, height: h, capsuleLeft, capsuleBottom } = size;
  const radius = 28;
  // The capsule anchors at the hero's right edge. Measure its actual left and
  // lower edge, then use those exact coordinates for a single continuous
  // pocket. This keeps the cutout clean when its controls change width.
  const pocketClearance = 8;
  const pocketLeft = Math.max(radius * 2, capsuleLeft - pocketClearance);
  const pocketBottom = Math.min(h - radius * 2, capsuleBottom + pocketClearance);
  const pocketCorner = Math.min(18, Math.max(12, pocketBottom / 2));
  const path = `M ${radius} 0 H ${pocketLeft - pocketCorner} Q ${pocketLeft} 0 ${pocketLeft} ${pocketCorner} V ${pocketBottom - pocketCorner} Q ${pocketLeft} ${pocketBottom} ${pocketLeft + pocketCorner} ${pocketBottom} H ${w - radius} Q ${w} ${pocketBottom} ${w} ${pocketBottom + radius} V ${h - radius} Q ${w} ${h} ${w - radius} ${h} H ${radius} Q 0 ${h} 0 ${h - radius} V ${radius} Q 0 0 ${radius} 0 Z`;

  return (
    <div className="company-page-hero-desktop hidden xl:block">
      <WorkspacePageContainer>
        <section ref={wrapperRef} className="company-page-hero" aria-labelledby="company-page-hero-title">
          {w > 0 && h > 0 && <svg className="company-page-hero-surface" width={w} height={h} aria-hidden="true">
            <defs><linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stopColor="var(--hero-start)" /><stop offset="65%" stopColor="var(--app-surface)" /><stop offset="100%" stopColor="var(--hero-end)" /></linearGradient></defs>
            <path d={path} fill={`url(#${gradientId})`} stroke="var(--hero-border)" strokeWidth="2" />
          </svg>}
          <div className="company-page-hero-copy min-w-0">
            <p className="company-page-hero-eyebrow">{metadata.eyebrow}</p>
            <h1 id="company-page-hero-title">{metadata.title}</h1>
            <p className="company-page-hero-description">{metadata.description}</p>
          </div>
          <div ref={capsuleRef} className="company-page-hero-utility"><CompanyHeroUtilityCapsule /></div>
        </section>
      </WorkspacePageContainer>
    </div>
  );
}
