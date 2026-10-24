import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { RecruitmentTab } from '../types/index.js';
import { Icon } from '../../../ui/Icon.js';

interface TabItem {
  readonly id: RecruitmentTab;
  readonly label: string;
  readonly path: string;
  readonly iconName: string;
}

const TABS: TabItem[] = [
  { id: 'overview', label: 'Overview', path: '/company/recruitment', iconName: 'chart' },
  { id: 'requisitions', label: 'Requisitions', path: '/company/recruitment/requisitions', iconName: 'briefcase' },
  { id: 'resumes', label: 'Resume Inbox', path: '/company/recruitment/resumes', iconName: 'notepad' },
  { id: 'candidates', label: 'Candidates', path: '/company/recruitment/candidates', iconName: 'users' },
  { id: 'interviews', label: 'Interviews', path: '/company/recruitment/interviews', iconName: 'history' },
  { id: 'offers', label: 'Offers', path: '/company/recruitment/offers', iconName: 'check' },
  { id: 'joining', label: 'Joining', path: '/company/recruitment/joining', iconName: 'building' },
  { id: 'my-interviews', label: 'My Interviews', path: '/company/recruitment/my-interviews', iconName: 'calendar' },
  { id: 'email-templates', label: 'Email Templates', path: '/company/recruitment/email-templates', iconName: 'message' },
];

export function RecruitmentTabs({
  activeTab,
  onNavigate,
  counts,
}: {
  readonly activeTab: RecruitmentTab;
  readonly onNavigate: (path: string) => void;
  readonly counts?: Partial<Record<RecruitmentTab, number>> | undefined;
}): React.JSX.Element {
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number; lastX: number; offsetX: number; moved: boolean } | null>(null);
  const pointerClientXRef = useRef<number | null>(null);
  const edgeScrollFrameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const activeButton = nav?.querySelector<HTMLElement>(`[data-recruitment-tab="${activeTab}"]`);
    if (!nav || !activeButton) return;

    const moveIndicator = () => {
      const navRect = nav.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      nav.style.setProperty('--recruitment-pill-left', `${buttonRect.left - navRect.left - nav.clientLeft + nav.scrollLeft}px`);
      nav.style.setProperty('--recruitment-pill-width', `${buttonRect.width}px`);
    };

    const navRect = nav.getBoundingClientRect();
    const visibleLeft = navRect.left + nav.clientLeft;
    const visibleRight = visibleLeft + nav.clientWidth;
    const activeRect = activeButton.getBoundingClientRect();
    if (activeRect.left < visibleLeft) nav.scrollLeft -= visibleLeft - activeRect.left;
    else if (activeRect.right > visibleRight) nav.scrollLeft += activeRect.right - visibleRight;

    moveIndicator();
    const observer = new ResizeObserver(moveIndicator);
    observer.observe(nav);
    observer.observe(activeButton);
    window.addEventListener('resize', moveIndicator);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', moveIndicator);
    };
  }, [activeTab]);

  const positionPillAtPointer = (clientX: number, deltaX = 0): boolean => {
    const origin = dragOriginRef.current;
    const nav = navRef.current;
    const pill = indicatorRef.current;
    if (!origin || !nav || !pill) return false;

    const navRect = nav.getBoundingClientRect();
    const visibleLeft = navRect.left + nav.clientLeft;
    const visibleRight = visibleLeft + nav.clientWidth;
    const edgeZone = Math.min(64, nav.clientWidth * 0.12);
    let scrollDelta = 0;
    if (clientX > visibleRight - edgeZone && nav.scrollLeft < nav.scrollWidth - nav.clientWidth) {
      const pressure = Math.min(1, (clientX - (visibleRight - edgeZone)) / edgeZone);
      scrollDelta = Math.ceil(4 + pressure * 20);
    } else if (clientX < visibleLeft + edgeZone && nav.scrollLeft > 0) {
      const pressure = Math.min(1, ((visibleLeft + edgeZone) - clientX) / edgeZone);
      scrollDelta = -Math.ceil(4 + pressure * 20);
    }
    if (scrollDelta !== 0) {
      nav.scrollLeft += scrollDelta;
    }

    const currentNavRect = nav.getBoundingClientRect();
    const pillWidth = Number.parseFloat(getComputedStyle(pill).width);
    const rawLeft = clientX - currentNavRect.left - nav.clientLeft + nav.scrollLeft - origin.offsetX;
    const maxLeft = Math.max(0, nav.scrollWidth - pillWidth);
    const left = Math.max(0, Math.min(maxLeft, rawLeft));
    const atRightEdge = rawLeft >= maxLeft - 1;
    const atLeftEdge = rawLeft <= 1;
    nav.style.setProperty('--recruitment-pill-left', `${left}px`);
    nav.style.setProperty('--pill-stretch', `${1 + Math.min(0.055, Math.abs(deltaX) * 0.002)}`);
    nav.style.setProperty('--pill-squash', `${1 - Math.min(0.02, Math.abs(deltaX) * 0.0007)}`);
    nav.style.setProperty('--recruitment-pill-origin', atRightEdge ? 'right center' : atLeftEdge ? 'left center' : deltaX >= 0 ? 'left center' : 'right center');

    return scrollDelta !== 0 && ((scrollDelta > 0 && nav.scrollLeft < nav.scrollWidth - nav.clientWidth) || (scrollDelta < 0 && nav.scrollLeft > 0));
  };

  const continueEdgeScroll = () => {
    if (edgeScrollFrameRef.current !== null) return;
    const tick = () => {
      edgeScrollFrameRef.current = null;
      if (pointerIdRef.current === null || pointerClientXRef.current === null) return;
      const shouldContinue = positionPillAtPointer(pointerClientXRef.current);
      if (shouldContinue) edgeScrollFrameRef.current = window.requestAnimationFrame(tick);
    };
    edgeScrollFrameRef.current = window.requestAnimationFrame(tick);
  };

  const movePillWhileDragging = (event: ReactPointerEvent<HTMLElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const origin = dragOriginRef.current;
    if (!origin) return;

    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4) origin.moved = true;
    if (!origin.moved) return;
    pointerClientXRef.current = event.clientX;
    const deltaX = event.clientX - origin.lastX;
    origin.lastX = event.clientX;
    const shouldContinue = positionPillAtPointer(event.clientX, deltaX);
    if (shouldContinue) continueEdgeScroll();
  };

  const startPillDrag = (event: ReactPointerEvent<HTMLButtonElement>, tab: RecruitmentTab) => {
    if (!window.matchMedia('(min-width: 1280px)').matches || tab !== activeTab || event.button !== 0) return;
    const nav = navRef.current;
    const pill = indicatorRef.current;
    if (!nav || !pill) return;

    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    pointerClientXRef.current = event.clientX;
    const pillRect = pill.getBoundingClientRect();
    dragOriginRef.current = {
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      offsetX: event.clientX - pillRect.left,
      moved: false,
    };
    nav.style.setProperty('--pill-stretch', '1');
    nav.style.setProperty('--pill-squash', '1');
    nav.style.setProperty('--recruitment-pill-origin', 'center');
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishPillDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const moved = dragOriginRef.current?.moved ?? false;
    const nav = navRef.current;
    const pill = indicatorRef.current;

    if (moved && nav && pill) {
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 600);
      const pillRect = pill.getBoundingClientRect();
      const center = pillRect.left + pillRect.width / 2;
      const nearest = TABS.map((tab) => {
        const button = nav.querySelector<HTMLElement>(`[data-recruitment-tab="${tab.id}"]`);
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { tab, distance: Math.abs(center - (rect.left + rect.width / 2)) };
      }).filter((entry): entry is { tab: TabItem; distance: number } => entry !== null)
        .sort((a, b) => a.distance - b.distance)[0]?.tab;

      if (nearest && nearest.id !== activeTab) onNavigate(nearest.path);
      if (nearest) {
        const button = nav.querySelector<HTMLElement>(`[data-recruitment-tab="${nearest.id}"]`);
        if (button) {
          const navRect = nav.getBoundingClientRect();
          const buttonRect = button.getBoundingClientRect();
          nav.style.setProperty('--recruitment-pill-left', `${buttonRect.left - navRect.left - nav.clientLeft + nav.scrollLeft}px`);
          nav.style.setProperty('--recruitment-pill-width', `${buttonRect.width}px`);
        }
      }
    }

    pointerIdRef.current = null;
    dragOriginRef.current = null;
    pointerClientXRef.current = null;
    if (edgeScrollFrameRef.current !== null) window.cancelAnimationFrame(edgeScrollFrameRef.current);
    edgeScrollFrameRef.current = null;
    nav?.style.removeProperty('--pill-stretch');
    nav?.style.removeProperty('--pill-squash');
    nav?.style.removeProperty('--recruitment-pill-origin');
    pill?.style.removeProperty('--recruitment-pill-left');
    pill?.style.removeProperty('--recruitment-pill-width');
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="mb-2 w-full">
      <nav
        ref={navRef}
        data-dragging={isDragging}
        onPointerMove={movePillWhileDragging}
        className="recruitment-tab-list -mb-px flex flex-nowrap items-center gap-1 overflow-x-auto rounded-xl p-1.5 scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Recruitment sections"
      >
        <span ref={indicatorRef} className="recruitment-tab-glass-indicator" aria-hidden="true" />
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = counts?.[tab.id];

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-recruitment-tab={tab.id}
              data-label={tab.label}
              onPointerDown={(event) => startPillDrag(event, tab.id)}
              onPointerUp={finishPillDrag}
              onPointerCancel={finishPillDrag}
              onLostPointerCapture={finishPillDrag}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                onNavigate(tab.path);
              }}
              className={`recruitment-tab-button flex shrink-0 items-center gap-2 rounded-lg border border-transparent px-3.5 py-2 text-sm font-semibold transition whitespace-nowrap md:px-4 md:py-2.5 ${
                isActive
                  ? 'text-app-accent'
                  : 'text-app-muted hover:border-app-border hover:bg-app-surface hover:text-app-foreground'
              }`}
            >
              <Icon name={tab.iconName} className="size-4 shrink-0" />
              <span>{tab.label}</span>
              {count !== undefined && count > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    isActive
                      ? 'bg-app-accent text-app-on-accent'
                      : 'border border-app-border bg-app-surface-raised text-app-muted'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
