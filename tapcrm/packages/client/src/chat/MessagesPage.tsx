import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { APP_NAVIGATE_EVENT, type AppNavigateEvent } from '../navigationEvent.js';
import { useTheme } from '../theme/ThemeContext.js';
import { getConversation } from './api/chatApi.js';
import { DirectMessagesPage } from './DirectMessagesPage.js';
import { InternalGroupsPage } from './InternalGroupsPage.js';
import { ProjectGroupsPage } from './ProjectGroupsPage.js';
import { useChatUnread } from './ChatUnreadContext.js';
import type { LiquidGlassLens } from 'liquid-gl';

type Tab = 'direct' | 'group' | 'project';

const TAB_FOR_KIND: Record<string, Tab> = { direct: 'direct', group: 'group', project: 'project' };

/**
 * The Messages module: Direct Messages (Phase 2), Internal Groups (Phase 3)
 * and Project Groups (Phase 4) — one conversation per project, created by
 * the project wizard's second step.
 */
export function MessagesPage({ currentUserId, isSuperAdmin, canManageProjects }: { currentUserId: string; isSuperAdmin: boolean; canManageProjects: boolean }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('direct');
  const [deepLink, setDeepLink] = useState<{ conversationId: string; messageId?: string | undefined } | undefined>(undefined);
  const unread = useChatUnread();
  const tabListRef = useRef<HTMLDivElement>(null);
  const glassIndicatorRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Partial<Record<Tab, HTMLButtonElement>>>({});
  const dragPointerId = useRef<number | null>(null);
  const dragOrigin = useRef<{ x: number; y: number; offsetX: number; moved: boolean } | null>(null);
  const suppressNextTabClick = useRef(false);
  const edgeResetTimer = useRef<number | undefined>(undefined);
  const lastEdgeHit = useRef<'left' | 'right' | null>(null);
  const [isDraggingTab, setIsDraggingTab] = useState(false);
  const [edgeHit, setEdgeHit] = useState<'left' | 'right' | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1280px)');
    let disposed = false;
    let lens: LiquidGlassLens | undefined;

    const syncGlassEffect = () => {
      lens?.destroy();
      lens = undefined;
      // The WebGL lens can produce pixel noise against the dark snapshot; the
      // CSS smoked-glass treatment is cleaner in dark mode. Keep the lens in
      // light mode, where its refraction reads clearly without a dark halo.
      if (!desktop.matches || resolvedTheme === 'dark') return;

      void import('liquid-gl').then(({ default: liquidGL }) => {
        if (disposed || !desktop.matches) return;
        const instance = liquidGL({
          target: '.messages-tab-glass-indicator',
          snapshot: 'body',
          // Keep the lens subtle: strong refraction was distorting the tab
          // labels captured in the page snapshot and creating noisy edge bands.
          resolution: 3,
          refraction: 0.002,
          bevelDepth: 0.04,
          bevelWidth: 0.08,
          frost: 0,
          shadow: false,
          specular: false,
          // The fluid displacement was visually bending the text captured in
          // the body snapshot as the lens crossed each label.
          interaction: 'none',
          reveal: 'fade',
          tint: 'rgba(255, 255, 255, 0.3)',
          zIndex: 11,
        });
        if (Array.isArray(instance)) {
          instance.forEach((item) => item.destroy());
        } else {
          lens = instance;
        }
      }).catch(() => {
        // Retain the existing CSS tab bar if WebGL/WebGPU is unavailable.
      });
    };

    syncGlassEffect();
    desktop.addEventListener('change', syncGlassEffect);
    return () => {
      disposed = true;
      desktop.removeEventListener('change', syncGlassEffect);
      lens?.destroy();
    };
  }, [resolvedTheme]);

  useLayoutEffect(() => {
    const tabList = tabListRef.current;
    if (!tabList) return;

    const syncIndicator = () => {
      if (dragPointerId.current !== null) return;
      const selectedButton = tabButtonRefs.current[tab];
      if (!selectedButton) return;
      const listRect = tabList.getBoundingClientRect();
      const buttonRect = selectedButton.getBoundingClientRect();
      const indicator = glassIndicatorRef.current;
      if (!indicator) return;
      indicator.style.setProperty('--pill-left', `${buttonRect.left - listRect.left - tabList.clientLeft}px`);
      indicator.style.setProperty('--pill-width', `${buttonRect.width}px`);
    };

    syncIndicator();
    const observer = new ResizeObserver(syncIndicator);
    observer.observe(tabList);
    Object.values(tabButtonRefs.current).forEach((button) => button && observer.observe(button));
    window.addEventListener('resize', syncIndicator);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncIndicator);
    };
  }, [tab]);

  useEffect(() => () => {
    if (edgeResetTimer.current !== undefined) window.clearTimeout(edgeResetTimer.current);
  }, []);

  const selectTabWhileDragging = (event: React.PointerEvent<HTMLElement>) => {
    if (dragPointerId.current !== event.pointerId) return;
    const origin = dragOrigin.current;
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4) origin.moved = true;
    if (!origin.moved) return;
    const deltaX = event.clientX - origin.x;

    const tabList = tabListRef.current;
    const activeButton = tabButtonRefs.current[tab];
    if (tabList && activeButton) {
      const trackRect = tabList.getBoundingClientRect();
      const firstRect = tabButtonRefs.current.direct?.getBoundingClientRect();
      const lastRect = tabButtonRefs.current.project?.getBoundingClientRect();
      const pillWidth = activeButton.getBoundingClientRect().width;
      const borderLeft = tabList.clientLeft;
      const minLeft = firstRect ? firstRect.left - trackRect.left - borderLeft : 0;
      const maxLeft = lastRect
        ? Math.max(minLeft, lastRect.right - trackRect.left - borderLeft - pillWidth)
        : trackRect.width - pillWidth;
      const rawLeft = event.clientX - trackRect.left - borderLeft - origin.offsetX;
      const left = Math.min(maxLeft, Math.max(minLeft, rawLeft));
      const hitEdge = rawLeft <= minLeft + 1 ? 'left' : rawLeft >= maxLeft - 1 ? 'right' : null;
      if (hitEdge && hitEdge !== lastEdgeHit.current) {
        lastEdgeHit.current = hitEdge;
        setEdgeHit(hitEdge);
        if (edgeResetTimer.current !== undefined) window.clearTimeout(edgeResetTimer.current);
        edgeResetTimer.current = window.setTimeout(() => setEdgeHit(null), 420);
      } else if (!hitEdge && lastEdgeHit.current !== null) {
        lastEdgeHit.current = null;
        setEdgeHit(null);
        if (edgeResetTimer.current !== undefined) window.clearTimeout(edgeResetTimer.current);
      }
      const indicator = glassIndicatorRef.current;
      if (indicator) {
        indicator.style.setProperty('--pill-left', `${left}px`);
        indicator.style.setProperty('--pill-width', `${pillWidth}px`);
        const stretch = 1 + Math.min(0.12, Math.abs(deltaX) * 0.006);
        const squash = 1 - Math.min(0.035, Math.abs(deltaX) * 0.0015);
        indicator.style.setProperty('--pill-stretch', stretch.toFixed(3));
        indicator.style.setProperty('--pill-squash', squash.toFixed(3));
        indicator.style.transformOrigin = deltaX >= 0 ? 'left center' : 'right center';
      }
    }

    // Only move the pill while dragging. Keep the labels and page content
    // stable until release so the active styling never jumps between tabs.
  };

  const startTabDrag = (event: React.PointerEvent<HTMLButtonElement>, value: Tab) => {
    if (!window.matchMedia('(min-width: 1280px)').matches || value !== tab || event.button !== 0) return;
    event.preventDefault();
    lastEdgeHit.current = null;
    setEdgeHit(null);
    dragPointerId.current = event.pointerId;
    const pillRect = glassIndicatorRef.current?.getBoundingClientRect();
    dragOrigin.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: pillRect ? event.clientX - pillRect.left : event.currentTarget.offsetWidth / 2,
      moved: false,
    };
    glassIndicatorRef.current?.style.setProperty('--pill-stretch', '1');
    glassIndicatorRef.current?.style.setProperty('--pill-squash', '1');
    if (glassIndicatorRef.current) glassIndicatorRef.current.style.transformOrigin = 'center';
    setIsDraggingTab(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishTabDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragPointerId.current !== event.pointerId) return;
    const didMove = dragOrigin.current?.moved ?? false;
    if (didMove) {
      suppressNextTabClick.current = true;
      window.setTimeout(() => { suppressNextTabClick.current = false; }, 600);
    }
    if (didMove) {
      const indicatorRect = glassIndicatorRef.current?.getBoundingClientRect();
      const dropCenter = indicatorRect
        ? indicatorRect.left + indicatorRect.width / 2
        : event.clientX;
      const closestTab = (['direct', 'group', 'project'] as const)
        .map((value) => {
          const button = tabButtonRefs.current[value];
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          return { value, distance: Math.abs(dropCenter - (rect.left + rect.width / 2)) };
        })
        .filter((candidate): candidate is { value: Tab; distance: number } => candidate !== null)
        .sort((a, b) => a.distance - b.distance)[0]?.value;
      const button = closestTab ? tabButtonRefs.current[closestTab] : undefined;
      const list = tabListRef.current;
      if (closestTab && button && list) {
        if (closestTab !== tab) {
          setDeepLink(undefined);
          setTab(closestTab);
        }
        const listRect = list.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const indicator = glassIndicatorRef.current;
        if (indicator) {
          indicator.style.setProperty('--pill-left', `${buttonRect.left - listRect.left - list.clientLeft}px`);
          indicator.style.setProperty('--pill-width', `${buttonRect.width}px`);
        }
      }
    }
    dragPointerId.current = null;
    dragOrigin.current = null;
    const indicator = glassIndicatorRef.current;
    if (indicator) {
      indicator.style.removeProperty('--pill-stretch');
      indicator.style.removeProperty('--pill-squash');
      indicator.style.removeProperty('transform-origin');
    }
    setIsDraggingTab(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // A notification click (e.g. a mention) arrives as "?conversationId=...&messageId=...";
  // resolve which tab that conversation lives on, then hand the id down so
  // ConversationWorkspace opens it and scrolls to the message.
  useEffect(() => {
    const resolve = (search: string): void => {
      const params = new URLSearchParams(search);
      const conversationId = params.get('conversationId');
      if (!conversationId) return;
      const messageId = params.get('messageId') ?? undefined;
      void getConversation(conversationId)
        .then((conversation) => {
          setTab(TAB_FOR_KIND[conversation.kind] ?? 'direct');
          setDeepLink({ conversationId, messageId });
        })
        .catch(() => undefined);
    };

    resolve(window.location.search); // arriving here fresh (e.g. from another page)

    // Also arriving here: a SECOND notification clicked while already on this
    // page. The URL changes (pushState) but this component's own mount
    // effect would never re-run on its own, since "pathname" itself doesn't
    // change when the destination is already "/company/messages" — so listen
    // for App.tsx's navigate() directly instead of only reading on mount.
    const onNavigate = (event: Event): void => {
      const target = (event as AppNavigateEvent).detail;
      const [path, search] = target.split('?');
      if (path !== '/company/messages' || !search) return;
      resolve(`?${search}`);
    };
    window.addEventListener(APP_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(APP_NAVIGATE_EVENT, onNavigate);
  }, []);

  return (
    <div className="messages-page flex h-full min-h-0 flex-col px-3 pb-3 sm:px-4 sm:pb-4 md:px-8 md:pb-8">
      <div ref={tabListRef} data-dragging={isDraggingTab} data-edge-hit={edgeHit ?? undefined} onPointerMove={selectTabWhileDragging} className="messages-tab-list flex shrink-0 gap-1 overflow-x-auto px-1 pt-3 scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:relative">
        <div
          ref={glassIndicatorRef}
          className="messages-tab-glass-indicator"
          aria-hidden="true"
        />
        {([['direct', 'Direct Messages'], ['group', 'Internal Groups'], ['project', 'Project Groups']] as const).map(([value, tabLabel]) => (
          <button
            key={value}
            ref={(element) => {
              if (element) tabButtonRefs.current[value] = element;
              else delete tabButtonRefs.current[value];
            }}
            onPointerDown={(event) => startTabDrag(event, value)}
            onPointerUp={finishTabDrag}
            onPointerCancel={finishTabDrag}
            onLostPointerCapture={finishTabDrag}
            type="button"
            aria-pressed={tab === value}
            data-label={tabLabel}
            onClick={() => {
              if (suppressNextTabClick.current) {
                suppressNextTabClick.current = false;
                return;
              }
              // A manual tab switch overrides whatever a notification deep
              // link opened — otherwise the old conversation keeps forcing
              // itself back open every time its tab remounts.
              setDeepLink(undefined);
              setTab(value);
            }}
            className={`messages-tab-button pointer-events-auto whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-semibold sm:px-3 sm:text-sm ${tab === value ? 'text-app-accent' : 'text-app-muted'}`}
          >
            <span className="sm:hidden">{value === 'direct' ? 'Direct' : value === 'group' ? 'Internal' : 'Project'}</span>
            <span className="hidden sm:inline">{tabLabel}</span>
            {unread[value] > 0 && (
              <span className="ml-1 rounded-full bg-app-accent px-1.5 py-0.5 text-[10px] font-bold text-app-on-accent">
                {unread[value] > 99 ? '99+' : unread[value]}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl bg-app-surface">
        {tab === 'direct' ? (
          <DirectMessagesPage currentUserId={currentUserId} initialConversationId={deepLink?.conversationId} initialMessageId={deepLink?.messageId} />
        ) : tab === 'group' ? (
          <InternalGroupsPage currentUserId={currentUserId} isSuperAdmin={isSuperAdmin} initialConversationId={deepLink?.conversationId} initialMessageId={deepLink?.messageId} />
        ) : (
          <ProjectGroupsPage currentUserId={currentUserId} canManageProjects={canManageProjects} initialConversationId={deepLink?.conversationId} initialMessageId={deepLink?.messageId} />
        )}
      </div>
    </div>
  );
}
