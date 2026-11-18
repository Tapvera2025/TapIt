import { useEffect, useRef, useState } from 'react';

const DESKTOP_BREAKPOINT = 1280;
const HOVER_OPEN_DELAY = 180;
const HOVER_CLOSE_DELAY = 150;

/** Shared responsive controller used by every portal's PortalSidebar. */
export function usePortalSidebarState() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    try {
      return window.localStorage.getItem('crm-sidebar-pinned') === 'true';
    } catch {
      return false;
    }
  });
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const savedWidth = Number(window.localStorage.getItem('tapcrm:sidebar-width'));
    return Number.isFinite(savedWidth) && savedWidth >= 220 && savedWidth <= 420
      ? savedWidth
      : 256;
  });
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const sidebarExpanded = sidebarPinned || sidebarHovered;

  useEffect(() => {
    try {
      window.localStorage.setItem('crm-sidebar-pinned', String(sidebarPinned));
      window.localStorage.setItem('tapcrm:sidebar-width', String(sidebarWidth));
    } catch {
      // Preserve in-memory behavior when browser storage is unavailable.
    }
  }, [sidebarPinned, sidebarWidth]);

  useEffect(() => () => {
    if (hoverTimerRef.current !== undefined) window.clearTimeout(hoverTimerRef.current);
  }, []);

  const clearHoverTimer = () => {
    if (hoverTimerRef.current !== undefined) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = undefined;
    }
  };

  const onSidebarPointerEnter = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || window.innerWidth < DESKTOP_BREAKPOINT || sidebarPinned) return;
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setSidebarHovered(true);
      hoverTimerRef.current = undefined;
    }, HOVER_OPEN_DELAY);
  };

  const onSidebarPointerLeave = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || sidebarPinned) return;
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setSidebarHovered(false);
      hoverTimerRef.current = undefined;
    }, HOVER_CLOSE_DELAY);
  };

  const onSidebarInteraction = () => {
    if (window.innerWidth < DESKTOP_BREAKPOINT || sidebarPinned) return;
    clearHoverTimer();
    setSidebarHovered(true);
  };

  const toggleSidebar = () => {
    if (window.innerWidth >= DESKTOP_BREAKPOINT) {
      setSidebarPinned((pinned) => !pinned);
    } else {
      setSidebarOpen((open) => !open);
    }
  };

  const closeSidebar = () => setSidebarOpen(false);

  return {
    sidebarOpen,
    setSidebarOpen,
    sidebarPinned,
    sidebarExpanded,
    sidebarCollapsed: sidebarOpen ? false : !sidebarExpanded,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebar,
    closeSidebar,
    onSidebarPointerEnter,
    onSidebarPointerLeave,
    onSidebarInteraction,
  };
}
