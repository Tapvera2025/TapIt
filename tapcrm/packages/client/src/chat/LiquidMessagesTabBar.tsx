import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { useTheme } from '../theme/ThemeContext.js';
import type { LiquidGlassLens } from 'liquid-gl';

export interface LiquidTabOption {
  value: string;
  label: string;
  shortLabel?: string;
  badge?: number;
}

/** The shared liquid-glass, draggable tab bar used by Messages and Projects. */
export function LiquidMessagesTabBar({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: readonly LiquidTabOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pointerId = useRef<number | null>(null);
  const dragOrigin = useRef<{ x: number; y: number; offsetX: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const edgeResetTimer = useRef<number | undefined>(undefined);
  const lastEdgeHit = useRef<'left' | 'right' | null>(null);
  const [dragging, setDragging] = useState(false);
  const [edgeHit, setEdgeHit] = useState<'left' | 'right' | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1280px)');
    let disposed = false;
    let lens: LiquidGlassLens | undefined;
    const syncGlassEffect = () => {
      lens?.destroy();
      lens = undefined;
      if (!desktop.matches || resolvedTheme === 'dark') return;
      void import('liquid-gl').then(({ default: liquidGL }) => {
        if (disposed || !desktop.matches) return;
        const instance = liquidGL({
          target: '.messages-tab-glass-indicator',
          snapshot: 'body',
          resolution: 3,
          refraction: 0.002,
          bevelDepth: 0.04,
          bevelWidth: 0.08,
          frost: 0,
          shadow: false,
          specular: false,
          interaction: 'none',
          reveal: 'fade',
          tint: 'rgba(255, 255, 255, 0.3)',
          zIndex: 11,
        });
        if (Array.isArray(instance)) instance.forEach((item) => item.destroy());
        else lens = instance;
      }).catch(() => undefined);
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
    const list = listRef.current;
    const indicator = indicatorRef.current;
    const selected = buttonRefs.current.get(value);
    if (!list || !indicator || !selected || pointerId.current !== null) return;
    const sync = () => {
      const listRect = list.getBoundingClientRect();
      const buttonRect = selected.getBoundingClientRect();
      indicator.style.setProperty('--pill-left', `${buttonRect.left - listRect.left - list.clientLeft + list.scrollLeft}px`);
      indicator.style.setProperty('--pill-width', `${buttonRect.width}px`);
      selected.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(list);
    tabs.forEach((tab) => {
      const button = buttonRefs.current.get(tab.value);
      if (button) observer.observe(button);
    });
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [value, tabs]);

  useEffect(() => () => {
    if (edgeResetTimer.current !== undefined) window.clearTimeout(edgeResetTimer.current);
  }, []);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    const origin = dragOrigin.current;
    const list = listRef.current;
    const indicator = indicatorRef.current;
    if (!origin || !list || !indicator) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4) origin.moved = true;
    if (!origin.moved) return;
    const deltaX = event.clientX - origin.x;
    const listRect = list.getBoundingClientRect();
    const first = tabs[0] ? buttonRefs.current.get(tabs[0].value) : undefined;
    const last = tabs.at(-1) ? buttonRefs.current.get(tabs.at(-1)!.value) : undefined;
    // Read the width from the tab, never the transformed pill. Reading the
    // pill's visual box here compounds its scale on every pointer frame.
    const activeButton = buttonRefs.current.get(value);
    const pillWidth = activeButton?.getBoundingClientRect().width ?? 0;
    const minLeft = first ? first.getBoundingClientRect().left - listRect.left - list.clientLeft + list.scrollLeft : 0;
    const maxLeft = last
      ? Math.max(minLeft, last.getBoundingClientRect().right - listRect.left - list.clientLeft + list.scrollLeft - pillWidth)
      : Math.max(minLeft, list.scrollWidth - pillWidth);
    const rawLeft = event.clientX - listRect.left - list.clientLeft + list.scrollLeft - origin.offsetX;

    // Let the track scroll when the dragged pill reaches either visible edge.
    const edgeZone = Math.min(48, list.clientWidth * 0.16);
    if (event.clientX < listRect.left + edgeZone && list.scrollLeft > 0) list.scrollLeft -= 12;
    else if (event.clientX > listRect.right - edgeZone && list.scrollLeft < list.scrollWidth - list.clientWidth) list.scrollLeft += 12;

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
    indicator.style.setProperty('--pill-left', `${left}px`);
    indicator.style.setProperty('--pill-width', `${pillWidth}px`);
    indicator.style.setProperty('--pill-stretch', (1 + Math.min(0.12, Math.abs(deltaX) * 0.006)).toFixed(3));
    indicator.style.setProperty('--pill-squash', (1 - Math.min(0.035, Math.abs(deltaX) * 0.0015)).toFixed(3));
    indicator.style.transformOrigin = deltaX >= 0 ? 'left center' : 'right center';
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, tabValue: string) => {
    if (!window.matchMedia('(min-width: 1280px)').matches || tabValue !== value || event.button !== 0) return;
    event.preventDefault();
    lastEdgeHit.current = null;
    setEdgeHit(null);
    pointerId.current = event.pointerId;
    const pillRect = indicatorRef.current?.getBoundingClientRect();
    dragOrigin.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: pillRect ? event.clientX - pillRect.left : event.currentTarget.offsetWidth / 2,
      moved: false,
    };
    indicatorRef.current?.style.setProperty('--pill-stretch', '1');
    indicatorRef.current?.style.setProperty('--pill-squash', '1');
    if (indicatorRef.current) indicatorRef.current.style.transformOrigin = 'center';
    setDragging(true);
    // Capture on the element that owns the pointer handlers. Capturing on a
    // child button and releasing on the track leaves the drag lifecycle split
    // across two elements, which can strand the indicator between tabs.
    listRef.current?.setPointerCapture(event.pointerId);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    const didMove = dragOrigin.current?.moved ?? false;
    const commit = event.type === 'pointerup';
    if (didMove && commit) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 600);
      const list = listRef.current;
      const indicator = indicatorRef.current;
      const left = Number.parseFloat(indicator?.style.getPropertyValue('--pill-left') ?? 'NaN');
      const width = buttonRefs.current.get(value)?.getBoundingClientRect().width ?? 0;
      const center = list && Number.isFinite(left)
        ? list.getBoundingClientRect().left + list.clientLeft + left - list.scrollLeft + width / 2
        : event.clientX;
      const closest = tabs.map((item) => {
        const button = buttonRefs.current.get(item.value);
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { value: item.value, distance: Math.abs(center - (rect.left + rect.width / 2)) };
      }).filter((item): item is { value: string; distance: number } => item !== null)
        .sort((a, b) => a.distance - b.distance)[0]?.value;
      if (closest) onChange(closest);
    } else if (didMove) {
      // A cancelled/lost drag returns to the selected tab instead of choosing
      // whichever tab happens to be nearest at the cancellation point.
      const list = listRef.current;
      const selected = buttonRefs.current.get(value);
      const indicator = indicatorRef.current;
      if (list && selected && indicator) {
        const listRect = list.getBoundingClientRect();
        const selectedRect = selected.getBoundingClientRect();
        indicator.style.setProperty('--pill-left', `${selectedRect.left - listRect.left - list.clientLeft + list.scrollLeft}px`);
        indicator.style.setProperty('--pill-width', `${selectedRect.width}px`);
      }
    }
    pointerId.current = null;
    dragOrigin.current = null;
    indicatorRef.current?.style.removeProperty('--pill-stretch');
    indicatorRef.current?.style.removeProperty('--pill-squash');
    if (indicatorRef.current) indicatorRef.current.style.removeProperty('transform-origin');
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      data-dragging={dragging}
      data-edge-hit={edgeHit ?? undefined}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      className={`messages-tab-list flex shrink-0 gap-1 overflow-x-auto px-1 pt-3 scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:relative ${className}`}
    >
      <div ref={indicatorRef} className="messages-tab-glass-indicator" aria-hidden="true" />
      {tabs.map((tab) => (
        <button
          key={tab.value}
          ref={(element) => {
            if (element) buttonRefs.current.set(tab.value, element);
            else buttonRefs.current.delete(tab.value);
          }}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          aria-pressed={value === tab.value}
          data-label={tab.label}
          data-liquid-ignore
          onPointerDown={(event) => startDrag(event, tab.value)}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            onChange(tab.value);
          }}
          className={`messages-tab-button pointer-events-auto whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-semibold sm:px-3 sm:text-sm ${value === tab.value ? 'text-app-accent' : 'text-app-muted'}`}
        >
          {tab.shortLabel ? <>
            <span className="sm:hidden">{tab.shortLabel}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </> : tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className="relative z-[2] ml-1 inline-flex shrink-0 items-center justify-center rounded-full bg-app-accent px-1.5 py-0.5 text-[10px] font-bold leading-none text-app-on-accent">
              {tab.badge > 99 ? '99+' : tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
