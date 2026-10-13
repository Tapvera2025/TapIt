import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import GridLayoutDefault from 'react-grid-layout';
import type { DashboardLayoutItem, DashboardPreferences, DashboardWidgetId } from '@tapcrm/contracts';

/**
 * react-grid-layout v1 exports the ReactGridLayout class as CommonJS default
 * with WidthProvider, Responsive, and the Layout type attached as statics.
 * The class type alone doesn't expose those, so we widen once at the import.
 */
interface RGLModule {
  WidthProvider<P extends object>(
    Component: ComponentType<P & { width?: number }>,
  ): ComponentType<P & { measureBeforeMount?: boolean }>;
}
interface RGLLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  static?: boolean;
}
type Layout = RGLLayoutItem;

const GridLayout = GridLayoutDefault;
const rglModule = GridLayoutDefault as unknown as RGLModule;
import { SkeletonCard, WorkspacePageContainer } from '../../ui/components.js';
import { Icon } from '../../ui/Icon.js';
import type { CompanyIdentity } from '../api/companyApi.js';
import { getDashboardPreferences, saveDashboardPreferences } from './dashboardApi.js';
import { availableWidgets, getWidget } from './registry.js';
import type { WidgetContext } from './widget-types.js';
import './dashboard.css';

const ResponsiveGrid = rglModule.WidthProvider(GridLayout as unknown as ComponentType<Record<string, unknown> & { width?: number }>);
const COLS = 12;
const ROW_HEIGHT = 56;

/**
 * The starter view for someone who has never customized their dashboard: three
 * personal cards, always available regardless of role. Everything else lives one
 * click away behind "Customize → Add widget". Keeps a first-time dashboard from
 * looking like a wall of empty boxes.
 */
const DEFAULT_WIDGETS: readonly DashboardWidgetId[] = ['punch-state', 'my-tasks', 'my-leave'];

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia('(max-width: 767px)');
    const handler = (event: MediaQueryListEvent) => setMobile(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);
  return mobile;
}

/** Build a grid layout for the visible widgets, using saved positions when available. */
function buildLayout(
  visibleIds: readonly DashboardWidgetId[],
  saved: readonly DashboardLayoutItem[],
): Layout[] {
  const savedById = new Map(saved.map((item) => [item.i, item]));
  const layout: Layout[] = [];
  let cursorY = 0;
  let cursorX = 0;
  for (const id of visibleIds) {
    const def = getWidget(id);
    if (!def) continue;
    const savedItem = savedById.get(id);
    if (savedItem) {
      layout.push({
        i: id,
        x: savedItem.x,
        y: savedItem.y,
        w: savedItem.w,
        h: savedItem.h,
        minW: def.defaultLayout.minW,
        minH: def.defaultLayout.minH,
      });
      continue;
    }
    const { w, h, minW, minH } = def.defaultLayout;
    if (cursorX + w > COLS) {
      cursorX = 0;
      cursorY += h;
    }
    layout.push({ i: id, x: cursorX, y: cursorY, w, h, minW, minH });
    cursorX += w;
  }
  return layout;
}

export function DashboardPage({
  identity,
  onNavigate,
}: {
  identity: CompanyIdentity;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const isMobile = useIsMobile();
  const [prefs, setPrefs] = useState<DashboardPreferences | null>(null);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mobileDragId, setMobileDragId] = useState<DashboardWidgetId | null>(null);
  const [mobileDropId, setMobileDropId] = useState<DashboardWidgetId | null>(null);
  const mobileDragRef = useRef<{ id: DashboardWidgetId; pointerId: number } | null>(null);
  const mobileDropRef = useRef<DashboardWidgetId | null>(null);

  const available = useMemo(() => availableWidgets(identity), [identity]);
  const availableIds = useMemo(() => available.map((widget) => widget.id), [available]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<DashboardPreferences> => {
      try {
        return await getDashboardPreferences();
      } catch {
        return getDashboardPreferences();
      }
    };
    load()
      .then((next) => {
        if (!cancelled) setPrefs(next);
      })
      .catch(() => {
        // Preferences endpoint is unreachable after a retry. Treat the user as
        // never-customized and show the curated default silently — a scary
        // banner on top of a working dashboard is worse than the transient
        // outage it announces.
        if (!cancelled) setPrefs({ layout: [], hidden: [], updatedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A user who has never saved prefs sees the curated default. Once they save
   * anything (updatedAt becomes non-null), we respect their explicit `hidden`
   * list — even if it's empty (i.e., "show me everything").
   */
  const hasSavedPrefs = prefs?.updatedAt != null;
  const hidden = useMemo<readonly DashboardWidgetId[]>(() => {
    if (!prefs) return [];
    if (hasSavedPrefs) return prefs.hidden;
    return availableIds.filter((id) => !DEFAULT_WIDGETS.includes(id));
  }, [prefs, hasSavedPrefs, availableIds]);

  const visibleIds = useMemo(
    () => availableIds.filter((id) => !hidden.includes(id)),
    [availableIds, hidden],
  );
  const layout = useMemo(
    () => buildLayout(visibleIds, prefs?.layout ?? []),
    [visibleIds, prefs?.layout],
  );
  const mobileOrderedIds = useMemo(
    () => [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((item) => item.i as DashboardWidgetId),
    [layout],
  );

  const persistTimer = useRef<number | null>(null);
  const persist = useCallback(
    (nextLayout: readonly DashboardLayoutItem[], nextHidden: readonly DashboardWidgetId[]) => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
      persistTimer.current = window.setTimeout(() => {
        void saveDashboardPreferences({ layout: nextLayout, hidden: nextHidden })
          .then((saved) => setPrefs(saved))
          .catch(() => undefined);
      }, 400);
    },
    [],
  );

  /**
   * Any customization commits the effective hidden set as the new explicit
   * saved state — otherwise the derived-default logic would keep overriding
   * their choice on the next render.
   */
  const commitPrefs = useCallback(
    (nextLayout: readonly DashboardLayoutItem[], nextHidden: readonly DashboardWidgetId[]) => {
      const now = new Date().toISOString();
      setPrefs((current) =>
        current ? { ...current, layout: [...nextLayout], hidden: [...nextHidden], updatedAt: now } : current,
      );
      persist(nextLayout, nextHidden);
    },
    [persist],
  );

  const handleLayoutChange = useCallback(
    (next: Layout[]) => {
      const items: DashboardLayoutItem[] = next
        .filter((item) => availableIds.includes(item.i as DashboardWidgetId))
        .map((item) => ({ i: item.i as DashboardWidgetId, x: item.x, y: item.y, w: item.w, h: item.h }));
      commitPrefs(items, hidden);
    },
    [availableIds, hidden, commitPrefs],
  );

  const hide = useCallback(
    (id: DashboardWidgetId) => {
      const nextHidden = [...hidden, id];
      const nextLayout = (prefs?.layout ?? []).filter((item) => item.i !== id);
      commitPrefs(nextLayout, nextHidden);
    },
    [hidden, prefs?.layout, commitPrefs],
  );

  const reorderMobile = useCallback(
    (fromId: DashboardWidgetId, toId: DashboardWidgetId) => {
      if (fromId === toId) return;
      const nextOrder = [...mobileOrderedIds];
      const fromIndex = nextOrder.indexOf(fromId);
      const toIndex = nextOrder.indexOf(toId);
      if (fromIndex < 0 || toIndex < 0) return;
      nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, fromId);
      const slots = new Map(
        mobileOrderedIds.map((id) => {
          const item = layout.find((entry) => entry.i === id);
          return [id, item ? { x: item.x, y: item.y } : { x: 0, y: 0 }];
        }),
      );
      const nextLayout = layout.map((item) => {
        const targetId = nextOrder[mobileOrderedIds.indexOf(item.i as DashboardWidgetId)];
        const slot = targetId ? slots.get(targetId) : undefined;
        return slot ? { ...item, x: slot.x, y: slot.y } : item;
      });
      commitPrefs(
        nextLayout.map(({ i, x, y, w, h }) => ({ i: i as DashboardWidgetId, x, y, w, h })),
        hidden,
      );
    },
    [mobileOrderedIds, layout, commitPrefs, hidden],
  );

  const resizeMobileWidget = useCallback(
    (id: DashboardWidgetId, delta: number) => {
      const nextLayout = layout.map((item) =>
        item.i === id
          ? { ...item, h: Math.min(10, Math.max(2, item.h + delta)) }
          : item,
      );
      commitPrefs(
        nextLayout.map(({ i, x, y, w, h }) => ({ i: i as DashboardWidgetId, x, y, w, h })),
        hidden,
      );
    },
    [layout, commitPrefs, hidden],
  );

  const setMobileWidgetHeight = useCallback(
    (id: DashboardWidgetId, height: number) => {
      const nextLayout = layout.map((item) =>
        item.i === id ? { ...item, h: Math.min(10, Math.max(2, height)) } : item,
      );
      commitPrefs(
        nextLayout.map(({ i, x, y, w, h }) => ({ i: i as DashboardWidgetId, x, y, w, h })),
        hidden,
      );
    },
    [layout, commitPrefs, hidden],
  );

  const handleMobileDragStart = (id: DashboardWidgetId, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    mobileDragRef.current = { id, pointerId: event.pointerId };
    mobileDropRef.current = id;
    setMobileDragId(id);
  };

  useEffect(() => {
    if (!mobileDragId) return;
    const resolveTarget = (x: number, y: number): DashboardWidgetId | null => {
      const value = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('[data-mobile-widget-id]')
        ?.dataset['mobileWidgetId'];
      return value && availableIds.includes(value as DashboardWidgetId)
        ? (value as DashboardWidgetId)
        : null;
    };
    const onMove = (event: PointerEvent) => {
      if (mobileDragRef.current?.pointerId !== event.pointerId) return;
      const target = resolveTarget(event.clientX, event.clientY);
      mobileDropRef.current = target;
      setMobileDropId(target);
    };
    const onEnd = (event: PointerEvent) => {
      const drag = mobileDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const target = resolveTarget(event.clientX, event.clientY) ?? mobileDropRef.current;
      if (target) reorderMobile(drag.id, target);
      mobileDragRef.current = null;
      mobileDropRef.current = null;
      setMobileDragId(null);
      setMobileDropId(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [mobileDragId, availableIds, reorderMobile]);

  const moveMobileBy = (id: DashboardWidgetId, delta: number) => {
    const index = mobileOrderedIds.indexOf(id);
    const target = mobileOrderedIds[index + delta];
    if (target) reorderMobile(id, target);
  };

  const add = useCallback(
    (id: DashboardWidgetId) => {
      const nextHidden = hidden.filter((item) => item !== id);
      const nextVisible = availableIds.filter((widgetId) => !nextHidden.includes(widgetId));
      const nextLayout: DashboardLayoutItem[] = buildLayout(nextVisible, prefs?.layout ?? []).map(
        ({ i, x, y, w, h }) => ({ i: i as DashboardWidgetId, x, y, w, h }),
      );
      commitPrefs(nextLayout, nextHidden);
      setPickerOpen(false);
    },
    [availableIds, hidden, prefs?.layout, commitPrefs],
  );

  /** Reset restores the curated default, not "show every widget". */
  const reset = useCallback(() => {
    const nextHidden = availableIds.filter((id) => !DEFAULT_WIDGETS.includes(id));
    commitPrefs([], nextHidden);
    setEditing(false);
    setPickerOpen(false);
  }, [availableIds, commitPrefs]);

  const ctx: WidgetContext = { identity, userId: identity.user.id, onNavigate };
  const hiddenWidgets = available.filter((widget) => hidden.includes(widget.id));

  if (!prefs) {
    return (
      <WorkspacePageContainer className="dashboard-workspace">
        <section className="dashboard-command-bar">
          <div className="min-w-0">
            <h1>Today at a glance</h1>
            <p>Preparing your workboard…</p>
          </div>
        </section>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((item) => <SkeletonCard key={item} className="h-36" />)}
        </div>
      </WorkspacePageContainer>
    );
  }

  return (
    <WorkspacePageContainer className="dashboard-workspace">
      <section className="dashboard-command-bar">
        <div className="min-w-0">
          <h1>Today at a glance</h1>
          <p>{identity.user.fullName}&rsquo;s operational workboard</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {editing && (
              <>
                <button
                  type="button"
                  onClick={() => setPickerOpen((open) => !open)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs font-semibold"
                >
                  <Icon name="plus" className="size-4" /> Add widget
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs font-semibold"
                >
                  <Icon name="refresh" className="size-4" /> Reset
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setEditing((flag) => !flag);
                setPickerOpen(false);
              }}
              className="ui-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
            >
              {editing ? 'Done' : 'Customize'}
            </button>
        </div>
      </section>
      {editing && pickerOpen && (
        <div className="mt-5 rounded-2xl border border-app-border bg-app-surface p-4">
          <p className="text-sm font-semibold">Add a widget</p>
          {hiddenWidgets.length === 0 ? (
            <p className="mt-2 text-xs text-app-muted">All available widgets are already on your dashboard.</p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {hiddenWidgets.map((widget) => (
                <li key={widget.id}>
                  <button
                    type="button"
                    onClick={() => add(widget.id)}
                    className="flex w-full flex-col rounded-lg border border-app-border bg-app-background/60 p-3 text-left hover:border-app-accent"
                  >
                    <span className="text-sm font-semibold">{widget.title}</span>
                    <span className="mt-1 text-xs text-app-muted">{widget.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {visibleIds.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-app-border bg-app-surface p-6 text-center">
          <p className="text-sm text-app-muted">Your dashboard is empty.</p>
          {!isMobile && (
            <button
              type="button"
              onClick={() => { setEditing(true); setPickerOpen(true); }}
              className="ui-primary mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
            >
              <Icon name="plus" className="size-4" /> Add widgets
            </button>
          )}
        </div>
      ) : isMobile ? (
        <div className="mt-5 space-y-4">
          {mobileOrderedIds.map((id) => {
            const def = getWidget(id);
            if (!def) return null;
            const Component = def.component;
            const layoutItem = layout.find((item) => item.i === id);
            const widgetHeight = Math.max(160, (layoutItem?.h ?? 3) * (ROW_HEIGHT + 16) - 16);
            return (
              <div
                key={id}
                data-mobile-widget-id={id}
                className={`mobile-dashboard-widget ${editing ? 'mobile-dashboard-widget-editing' : ''} ${mobileDragId === id ? 'mobile-dashboard-widget-dragging' : ''} ${mobileDropId === id && mobileDragId !== id ? 'mobile-dashboard-widget-drop-target' : ''}`}
                style={{ height: editing ? `${widgetHeight}px` : undefined }}
              >
                {editing && (
                  <div className="mobile-dashboard-widget-controls mb-3 flex items-center justify-between gap-2 border-b border-app-border pb-2">
                    <button
                      type="button"
                      className="mobile-dashboard-drag-handle inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-app-muted"
                      aria-label={`Drag to reorder ${def.title}`}
                      title="Hold and drag to reorder"
                      onPointerDown={(event) => handleMobileDragStart(id, event)}
                    >
                      <Icon name="menu" className="size-4" />
                      <span>Move</span>
                    </button>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => moveMobileBy(id, -1)} disabled={mobileOrderedIds[0] === id} className="mobile-dashboard-control-button" aria-label={`Move ${def.title} up`} title="Move up">↑</button>
                      <button type="button" onClick={() => moveMobileBy(id, 1)} disabled={mobileOrderedIds[mobileOrderedIds.length - 1] === id} className="mobile-dashboard-control-button" aria-label={`Move ${def.title} down`} title="Move down">↓</button>
                      <span className="mx-1 h-5 w-px bg-app-border" />
                      <button type="button" onClick={() => resizeMobileWidget(id, -1)} disabled={(layoutItem?.h ?? 3) <= 2} className="mobile-dashboard-control-button" aria-label={`Make ${def.title} shorter`} title="Shorter">−</button>
                      <button type="button" onClick={() => resizeMobileWidget(id, 1)} disabled={(layoutItem?.h ?? 3) >= 10} className="mobile-dashboard-control-button" aria-label={`Make ${def.title} taller`} title="Taller">+</button>
                      <button type="button" onClick={() => hide(id)} className="mobile-dashboard-control-button mobile-dashboard-remove" aria-label={`Remove ${def.title}`} title="Remove widget">
                        <Icon name="close" className="size-3.5" />
                      </button>
                    </div>
                  </div>
                )}
                {editing && (
                  <label className="mobile-dashboard-size-control mb-3 flex items-center gap-3 text-xs font-semibold text-app-muted">
                    <span>Card height</span>
                    <input
                      type="range"
                      min={2}
                      max={10}
                      step={1}
                      value={layoutItem?.h ?? 3}
                      onChange={(event) => setMobileWidgetHeight(id, Number(event.currentTarget.value))}
                      aria-label={`Card height for ${def.title}`}
                    />
                  </label>
                )}
                <div className={editing ? 'mobile-dashboard-widget-content' : ''}>
                  <Component ctx={ctx} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`dashboard-grid mt-5 ${editing ? 'editing' : ''}`}>
          <ResponsiveGrid
            className="layout"
            layout={layout}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            margin={[16, 16]}
            containerPadding={[0, 0]}
            isDraggable={editing}
            isResizable={editing}
            onLayoutChange={handleLayoutChange}
            draggableCancel=".dashboard-widget-remove, .dashboard-widget-nodrag"
          >
            {visibleIds.map((id) => {
              const def = getWidget(id);
              if (!def) return <div key={id} />;
              const Component = def.component;
              return (
                <div key={id}>
                  {editing && (
                    <button
                      type="button"
                      aria-label={`Remove ${def.title}`}
                      className="dashboard-widget-remove"
                      onClick={() => hide(id)}
                    >
                      <Icon name="close" className="size-3.5" />
                    </button>
                  )}
                  <Component ctx={ctx} />
                </div>
              );
            })}
          </ResponsiveGrid>
        </div>
      )}
    </WorkspacePageContainer>
  );
}
