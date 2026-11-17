import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.js';

type ScrollEdges = {
  hasOverflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
};

export function HorizontalScrollArea({
  children,
  ariaLabel = 'Horizontally scrollable content',
  className = '',
  contentClassName = '',
  showArrows = true,
}: {
  children: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  contentClassName?: string;
  showArrows?: boolean;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollEdges>({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateEdges = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    const next: ScrollEdges = {
      hasOverflow: maxScrollLeft > 1,
      canScrollLeft: element.scrollLeft > 1,
      canScrollRight: maxScrollLeft - element.scrollLeft > 1,
    };
    setEdges((current) => current.hasOverflow === next.hasOverflow
      && current.canScrollLeft === next.canScrollLeft
      && current.canScrollRight === next.canScrollRight
      ? current
      : next);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    window.addEventListener('resize', updateEdges);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateEdges);
    };
  }, [children, updateEdges]);

  function scroll(direction: -1 | 1) {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollBy({ left: direction * Math.max(220, element.clientWidth * 0.72), behavior: 'smooth' });
  }

  return (
    <div className={`attendance-horizontal-scroll-area group relative min-w-0 ${className}`}>
      <div
        ref={scrollRef}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={updateEdges}
        className={`min-w-0 overflow-x-auto overscroll-x-contain ${contentClassName}`}
      >
        {children}
      </div>
      {showArrows && edges.hasOverflow && edges.canScrollLeft && (
        <button
          type="button"
          aria-label="Scroll left"
          title="Scroll left"
          onClick={() => scroll(-1)}
          className="attendance-horizontal-scroll-arrow absolute left-2 top-1/2 z-20 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-app-border bg-app-surface/95 text-app-foreground shadow-md backdrop-blur transition hover:border-app-accent hover:text-app-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
        >
          <Icon name="chevron-left" className="size-4" />
        </button>
      )}
      {showArrows && edges.hasOverflow && edges.canScrollRight && (
        <button
          type="button"
          aria-label="Scroll right"
          title="Scroll right"
          onClick={() => scroll(1)}
          className="attendance-horizontal-scroll-arrow absolute right-2 top-1/2 z-20 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-app-border bg-app-surface/95 text-app-foreground shadow-md backdrop-blur transition hover:border-app-accent hover:text-app-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
        >
          <Icon name="chevron-right" className="size-4" />
        </button>
      )}
    </div>
  );
}
