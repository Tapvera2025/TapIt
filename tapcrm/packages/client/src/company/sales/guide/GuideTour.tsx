import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../../ui/index.js';
import { placeTourCard, type TourRect, type TourStop } from './tour.js';
import './sales-tour.css';

function visibleTarget(selector: string | undefined): HTMLElement | null {
  if (!selector) return null;
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((node) => node.getClientRects().length > 0) ?? null;
}

export function GuideTour({ stops, context, children, onClose, onMinimize }: { stops: readonly TourStop[]; context: string; children: ReactNode; onClose: () => void; onMinimize: () => void }): React.JSX.Element {
  const [selected, setSelected] = useState(stops[0]?.id);
  const index = Math.max(0, stops.findIndex((stop) => stop.id === selected));
  const stop = stops[index]!;
  const [layout, setLayout] = useState<{ target: TourRect | null; width: number; height: number; viewport: { width: number; height: number } }>({ target: null, width: 370, height: 220, viewport: { width: window.innerWidth, height: window.innerHeight } });
  const dialog = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onClose });
  callbacks.current = { onClose };
  const titleId = useId();
  const maskId = useId().replaceAll(':', '');
  const last = index === stops.length - 1;
  const go = (delta: number): void => { const next = stops[index + delta]; if (next) setSelected(next.id); };

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The portal is the sole interactive surface while the tour is open.
    const siblings = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== dialog.current);
    const previousInert = siblings.map((node) => node.inert);
    siblings.forEach((node) => { node.inert = true; });
    nextButton.current?.focus();
    return () => {
      siblings.forEach((node, i) => { node.inert = previousInert[i] ?? false; });
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    let frame = 0;
    const measure = (): void => {
      const target = visibleTarget(stop.target);
      const rect = target?.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const left = Math.max(8, rect?.left ?? 0);
      const top = Math.max(8, rect?.top ?? 0);
      const right = Math.min(viewport.width - 8, rect?.right ?? 0);
      const bottom = Math.min(viewport.height - 92, rect?.bottom ?? 0);
      const targetRect = rect && right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
      const next = { target: targetRect, width: card.current?.offsetWidth ?? 370, height: card.current?.offsetHeight ?? 220, viewport };
      setLayout((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    visibleTarget(stop.target)?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    measure();
    const resize = new ResizeObserver(schedule);
    if (card.current) resize.observe(card.current);
    const target = visibleTarget(stop.target);
    if (target) resize.observe(target);
    // Delayed list data can add or replace the anchor while the tour is open.
    const mutation = new MutationObserver(schedule);
    const main = document.getElementById('main-content');
    if (main) mutation.observe(main, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [stop.id, stop.target]);

  const position = placeTourCard(layout.target, layout.width, layout.height, layout.viewport);
  const target = layout.target;
  // Connect the nearest card edge to the nearest target edge.
  const cardX = position.x + layout.width / 2;
  const cardY = position.y + layout.height / 2;
  const targetX = target ? Math.max(target.x, Math.min(cardX, target.x + target.width)) : 0;
  const targetY = target ? Math.max(target.y, Math.min(cardY, target.y + target.height)) : 0;
  const startX = Math.max(position.x + 20, Math.min(targetX, position.x + layout.width - 20));
  const startY = targetY < position.y ? position.y : targetY > position.y + layout.height ? position.y + layout.height : cardY;
  const endX = targetX;
  const endY = targetY;
  const path = `M ${startX} ${startY} Q ${startX + (endX - startX) * 0.25} ${endY} ${endX} ${endY}`;

  return createPortal(
    <div ref={dialog} className="sales-tour" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); callbacks.current.onClose(); }
      if (event.key === 'Tab') {
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []);
        const first = buttons[0]; const final = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); final?.focus(); }
        if (!event.shiftKey && document.activeElement === final) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <svg className="sales-tour-canvas" aria-hidden="true" width="100%" height="100%">
        <defs>
          <mask id={maskId}><rect width="100%" height="100%" fill="white" />{target && <rect x={target.x - 6} y={target.y - 6} width={target.width + 12} height={target.height + 12} rx="16" fill="black" />}</mask>
          <marker id={`${maskId}-arrow`} markerWidth="12" markerHeight="12" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="#ff7a18" strokeWidth="3" strokeLinejoin="round" /></marker>
        </defs>
        <rect width="100%" height="100%" fill="rgba(25, 32, 49, .32)" mask={`url(#${maskId})`} />
        {target && <rect x={target.x - 6} y={target.y - 6} width={target.width + 12} height={target.height + 12} rx="16" fill="none" stroke="white" strokeWidth="5" />}
        {target && layout.viewport.width >= 640 && <><path d={path} fill="none" stroke="white" strokeWidth="8" /><path d={path} fill="none" stroke="#ff7a18" strokeWidth="3.5" markerEnd={`url(#${maskId}-arrow)`} /></>}
      </svg>
      <section ref={card} className="sales-tour-card" style={{ left: position.x, top: position.y }}>
        <span className="sales-tour-number" aria-hidden="true">{index + 1}</span>
        <div className="sales-tour-copy" aria-live="polite" aria-atomic="true">
          <p className="sales-tour-eyebrow">{context} · Guide</p>
          <h2 id={titleId}>{stop.title}</h2>
          <p className="sales-tour-detail">{stop.detail}</p>
          {stop.contextual && children}
        </div>
        <button type="button" className="sales-tour-minimize" aria-label="Minimize the guide" onClick={onMinimize}><Icon name="minus" className="size-4" /></button>
      </section>
      <nav className="sales-tour-controls" aria-label="Guide controls">
        <div className="sales-tour-progress"><strong>{context} tour</strong><span aria-live="polite">{index + 1}/{stops.length}</span></div>
        <div className="sales-tour-dots" aria-hidden="true">{stops.map((item, i) => <span key={item.id} className={i === index ? 'active' : ''} />)}</div>
        <button type="button" className="sales-tour-skip" onClick={onClose}>Skip</button>
        <button type="button" className="sales-tour-back" disabled={index === 0} onClick={() => go(-1)}>Back</button>
        <button ref={nextButton} type="button" className="sales-tour-next" onClick={() => last ? onClose() : go(1)}>{last ? 'Finish' : 'Next'}<Icon name={last ? 'check' : 'arrow-right'} className="size-4" /></button>
      </nav>
    </div>, document.body,
  );
}
