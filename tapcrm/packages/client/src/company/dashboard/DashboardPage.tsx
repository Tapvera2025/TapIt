import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import GridLayoutDefault from 'react-grid-layout';
import type { DashboardLayoutItem, DashboardPreferences, DashboardWidgetId } from '@tapcrm/contracts';

/**
 * react-grid-layout v1 exports the ReactGridLayout class as CommonJS default
 * with WidthProvider, Responsive, and the Layout type attached as statics.
 * The class type alone doesn't expose those, so we widen once at the import.
 */
interface RGLModule {
  Responsive: ComponentType<Record<string, unknown> & { width?: number }>;
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
  maxW?: number;
  maxH?: number;
  isResizable?: boolean;
  static?: boolean;
}
type Layout = RGLLayoutItem;

const rglModule = GridLayoutDefault as unknown as RGLModule;
import { GlassSurface, SkeletonCard, WorkspacePageContainer } from '../../ui/index.js';
import { Icon } from '../../ui/index.js';
import type { CompanyIdentity } from '../api/companyApi.js';
import { getDashboardPreferences, saveDashboardPreferences } from './dashboardApi.js';
import { reflowGridLayout } from './layout-engine.js';
import { availableWidgets, getWidget } from './registry.js';
import type { WidgetContext } from './widget-types.js';
import './dashboard.css';

const ResponsiveGrid = rglModule.WidthProvider(rglModule.Responsive);
const COLS = 12;
const ROW_HEIGHT = 56;
const TABLET_COLS = 8;
const GRID_BREAKPOINTS = { lg: 1200, md: 768 };
const GRID_COLS = { lg: COLS, md: TABLET_COLS };

/** Curated first-visit widgets, arranged into a balanced two-column canvas. */
const EMPLOYEE_DEFAULT_WIDGETS: readonly DashboardWidgetId[] = ['punch-state', 'my-tasks', 'my-leave'];
const ADMIN_DEFAULT_WIDGETS: readonly DashboardWidgetId[] = [
  'admin-pending-requests',
  'admin-team-attendance',
  'admin-sales-calls',
  'admin-callbacks',
  'admin-meetings',
  'admin-activity',
  'org-visible-employees',
  'org-team-distribution',
];

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

function layoutKey(item: Pick<DashboardLayoutItem, 'i' | 'instanceId'>): string {
  return item.instanceId ? `${item.i}::${item.instanceId}` : item.i;
}

function parseLayoutKey(key: string): { id: DashboardWidgetId; instanceId?: string } | null {
  const separator = key.indexOf('::');
  const id = (separator < 0 ? key : key.slice(0, separator)) as DashboardWidgetId;
  if (!getWidget(id)) return null;
  const instanceId = separator < 0 ? undefined : key.slice(separator + 2);
  return instanceId ? { id, instanceId } : { id };
}

function overlaps(a: Pick<Layout, 'x' | 'y' | 'w' | 'h'>, b: Pick<Layout, 'x' | 'y' | 'w' | 'h'>): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function firstFreePosition(
  item: Layout,
  placed: readonly Layout[],
  cols: number,
  startY: number,
  startX = 0,
): Pick<Layout, 'x' | 'y'> {
  const maxY = Math.max(startY + 1000, ...placed.map((entry) => entry.y + entry.h + 100));
  for (let y = Math.max(0, startY); y <= maxY; y += 1) {
    const firstX = y === startY ? Math.max(0, Math.min(startX, cols - item.w)) : 0;
    for (let x = firstX; x <= cols - item.w; x += 1) {
      const candidate = { ...item, x, y };
      if (!placed.some((entry) => overlaps(candidate, entry))) return { x, y };
    }
  }
  return { x: 0, y: maxY + 1 };
}

/** Repack widgets into the earliest open cells without changing their sizes. */
function resolveLayout(layout: readonly Layout[], cols: number, pinnedKey?: string): Layout[] {
  return reflowGridLayout(layout, cols, pinnedKey);
}

function scaleLayout(layout: readonly Layout[], cols: number): Layout[] {
  if (cols === COLS) return layout.map((item) => ({ ...item }));
  const scaled = layout.map((item) => {
    const parsed = parseLayoutKey(item.i);
    const definition = parsed ? getWidget(parsed.id) : undefined;
    const ratio = cols / COLS;
    const minW = Math.min(cols, Math.max(1, Math.ceil((item.minW ?? 1) * ratio)));
    const maxW = Math.max(minW, Math.min(cols, Math.ceil((item.maxW ?? COLS) * ratio)));
    const start = Math.round(item.x * ratio);
    const end = Math.round((item.x + item.w) * ratio);
    const w = Math.min(maxW, Math.max(minW, end - start));
    return {
      ...item,
      x: Math.min(cols - w, start),
      w,
      minW,
      maxW,
      ...(definition?.defaultLayout.resizable === false ? { isResizable: false } : {}),
    };
  });
  return resolveLayout(scaled, cols);
}

function toSavedLayout(layout: readonly Layout[], cols: number): DashboardLayoutItem[] {
  const scale = COLS / cols;
  return layout.flatMap((item) => {
    const parsed = parseLayoutKey(item.i);
    if (!parsed) return [];
    const x = Math.max(0, Math.round(item.x * scale));
    const end = Math.min(COLS, Math.round((item.x + item.w) * scale));
    return [{
      i: parsed.id,
      ...(parsed.instanceId ? { instanceId: parsed.instanceId } : {}),
      x,
      y: Math.max(0, item.y),
      w: Math.max(1, end - x),
      h: Math.max(1, item.h),
    }];
  });
}

/** Build a persisted 12-column layout, repairing legacy collisions on load. */
function buildLayout(
  orderedIds: readonly DashboardWidgetId[],
  saved: readonly DashboardLayoutItem[],
  hidden: readonly DashboardWidgetId[],
  seedStarterGrid: boolean,
): Layout[] {
  const savedById = new Map<DashboardWidgetId, DashboardLayoutItem[]>();
  for (const item of saved) savedById.set(item.i, [...(savedById.get(item.i) ?? []), item]);
  const requested: Array<{ item: Layout; anchored: boolean }> = [];
  const halfWidth = Math.ceil(COLS / 2);
  let starterColumn = 0;
  let starterRowY = 0;
  let starterRowHeight = 0;

  for (const id of orderedIds) {
    const def = getWidget(id);
    if (!def) continue;
    const existing = savedById.get(id) ?? [];
    const primary = existing.find((item) => !item.instanceId);
    const copies = existing.filter((item) => Boolean(item.instanceId));
    if (!hidden.includes(id)) {
      let seed: DashboardLayoutItem | undefined;
      if (seedStarterGrid && !primary) {
        const limits = def.defaultLayout;
        const minW = Math.min(COLS, Math.max(1, limits.minW));
        const maxW = Math.max(minW, Math.min(COLS, limits.maxW ?? COLS));
        const h = Math.max(limits.minH, limits.h);
        const fullWidth = minW > halfWidth;
        const w = Math.min(maxW, Math.max(minW, fullWidth ? limits.w : halfWidth));
        if (fullWidth) {
          if (starterColumn === 1) {
            starterRowY += starterRowHeight;
            starterColumn = 0;
            starterRowHeight = 0;
          }
          seed = { i: id, x: 0, y: starterRowY, w, h };
          starterRowY += h;
        } else {
          seed = { i: id, x: starterColumn * halfWidth, y: starterRowY, w, h };
          if (starterColumn === 0) {
            starterColumn = 1;
            starterRowHeight = h;
          } else {
            starterRowY += Math.max(starterRowHeight, h);
            starterColumn = 0;
            starterRowHeight = 0;
          }
        }
      }
      const source = primary ?? seed;
      if (source) {
        requested.push({ item: toGridItem(source, def), anchored: Boolean(primary || seed) });
      } else {
        requested.push({ item: toGridItem({ i: id, x: 0, y: 0, w: def.defaultLayout.w, h: def.defaultLayout.h }, def), anchored: false });
      }
    }
    for (const copy of copies) {
      requested.push({ item: toGridItem(copy, def), anchored: true });
    }
  }

  requested.sort((a, b) => {
    if (a.anchored !== b.anchored) return a.anchored ? -1 : 1;
    return a.item.y - b.item.y || a.item.x - b.item.x || a.item.i.localeCompare(b.item.i);
  });
  const placed: Layout[] = [];
  for (const { item, anchored } of requested) {
    const bounded = { ...item, x: Math.max(0, Math.min(COLS - item.w, item.x)), y: Math.max(0, item.y) };
    const position = placed.some((entry) => overlaps(bounded, entry))
      ? firstFreePosition(bounded, placed, COLS, anchored ? bounded.y : 0, anchored ? bounded.x : 0)
      : { x: bounded.x, y: bounded.y };
    placed.push({ ...bounded, ...position });
  }
  return placed;
}

function toGridItem(item: DashboardLayoutItem, definition: NonNullable<ReturnType<typeof getWidget>>): Layout {
  const limits = definition.defaultLayout;
  const minW = Math.min(COLS, Math.max(1, limits.minW));
  const maxW = Math.max(minW, Math.min(COLS, limits.maxW ?? COLS));
  const minH = Math.max(1, limits.minH);
  const maxH = Math.max(minH, Math.min(48, limits.maxH ?? 48));
  const w = Math.min(maxW, Math.max(minW, Math.min(COLS, item.w)));
  const h = Math.min(maxH, Math.max(minH, Math.min(48, item.h)));
  return {
    i: layoutKey(item),
    x: Math.max(0, Math.min(COLS - w, item.x)),
    y: Math.max(0, item.y),
    w,
    h,
    minW,
    minH,
    maxW,
    maxH,
    isResizable: limits.resizable !== false,
  };
}

const SIZE_PRESETS = [
  { id: '1x1', label: '1 × 1', width: 0.5, height: 5 },
  { id: '2x1', label: '2 × 1', width: 1, height: 5 },
  { id: '1x2', label: '1 × 2', width: 0.5, height: 10 },
  { id: '2x2', label: '2 × 2', width: 1, height: 10 },
] as const;

function WidgetSettingsMenu({
  widgetKey,
  title,
  description,
  cols,
  minW,
  minH,
  maxW,
  maxH,
  resizable,
  onSize,
  onDuplicate,
  onRemove,
}: {
  widgetKey: string;
  title: string;
  description: string;
  cols: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  resizable: boolean;
  onSize: (key: string, preset: '1x1' | '2x1' | '1x2' | '2x2') => void;
  onDuplicate: (key: string) => void;
  onRemove: (key: string) => void;
}): React.JSX.Element {
  return (
    <details className="dashboard-widget-settings">
      <summary aria-label={`Configure ${title}`} title="Configure widget">
        <Icon name="settings" className="size-3.5" />
      </summary>
      <div className="dashboard-widget-settings-panel">
        <p className="dashboard-widget-settings-title">Configure {title}</p>
        <p className="dashboard-widget-settings-description">{description}</p>
        <span className="dashboard-widget-settings-label">Size</span>
        <div className="dashboard-widget-size-presets">
          {SIZE_PRESETS.map((preset) => {
            const width = Math.max(1, Math.floor(cols * preset.width));
            return (
              <button
                key={preset.id}
                type="button"
                disabled={!resizable || width < minW || width > maxW || preset.height < minH || preset.height > maxH}
                onClick={() => onSize(widgetKey, preset.id)}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div className="dashboard-widget-settings-actions">
          <button type="button" onClick={() => onDuplicate(widgetKey)}>
            <Icon name="copy" className="size-3.5" /> Duplicate
          </button>
          <button type="button" className="dashboard-widget-settings-remove" onClick={() => onRemove(widgetKey)}>
            <Icon name="close" className="size-3.5" /> Remove
          </button>
        </div>
      </div>
    </details>
  );
}

export function DashboardPage({
  identity,
  onNavigate,
}: {
  identity: CompanyIdentity;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const isAdminDashboard = identity.user.accountType === 'super-admin';
  const defaultWidgets = isAdminDashboard ? ADMIN_DEFAULT_WIDGETS : EMPLOYEE_DEFAULT_WIDGETS;
  const timeZone = identity.organization?.timezone ?? 'UTC';
  const dashboardDate = new Intl.DateTimeFormat('en', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone,
  }).format(new Date());
  const isMobile = useIsMobile();
  const [prefs, setPrefs] = useState<DashboardPreferences | null>(null);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [gridCols, setGridCols] = useState(COLS);
  const [mobileDragId, setMobileDragId] = useState<string | null>(null);
  const [mobileDropId, setMobileDropId] = useState<string | null>(null);
  const mobileDragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const mobileDropRef = useRef<string | null>(null);
  const activeColsRef = useRef(COLS);

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
    if (hasSavedPrefs) {
      // Break management was added after existing dashboard preferences were
      // created. Keep it optional for those users so it appears in Add widget.
      const savedIds = new Set(prefs.layout.map((item) => item.i));
      return [...new Set([
        ...prefs.hidden,
        ...availableIds.filter((id) => id === 'break-management' && !savedIds.has(id)),
      ])];
    }
    return availableIds.filter((id) => !defaultWidgets.includes(id));
  }, [prefs, hasSavedPrefs, availableIds, defaultWidgets]);

  const orderedIds = useMemo(() => {
    if (!isAdminDashboard) return availableIds;
    return [
      ...ADMIN_DEFAULT_WIDGETS.filter((id) => availableIds.includes(id)),
      ...availableIds.filter((id) => !ADMIN_DEFAULT_WIDGETS.includes(id)),
    ];
  }, [availableIds, isAdminDashboard]);
  const layout = useMemo(
    () => resolveLayout(
      buildLayout(orderedIds, prefs?.layout ?? [], hidden, (prefs?.layout.length ?? 0) === 0),
      COLS,
    ),
    [orderedIds, prefs?.layout, hidden],
  );
  const mobileOrderedIds = useMemo(
    () => [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((item) => item.i),
    [layout],
  );

  const persistTimer = useRef<number | null>(null);
  const persistSequence = useRef(0);
  const persist = useCallback(
    (nextLayout: readonly DashboardLayoutItem[], nextHidden: readonly DashboardWidgetId[]) => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
      const sequence = ++persistSequence.current;
      persistTimer.current = window.setTimeout(() => {
        void saveDashboardPreferences({ layout: nextLayout, hidden: nextHidden })
          .then((saved) => {
            if (sequence === persistSequence.current) setPrefs(saved);
          })
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

  const handleGridInteractionStop = useCallback(
    (next: Layout[], _oldItem?: Layout, changedItem?: Layout) => {
      const cols = activeColsRef.current;
      const collisionSafe = resolveLayout(next, cols, changedItem?.i);
      // Persist the resolved grid directly. Rebuilding from the saved items
      // here re-sorted anchored widgets and could move the resized widget
      // back over its neighbours on the next render.
      commitPrefs(toSavedLayout(collisionSafe, cols), hidden);
    },
    [hidden, commitPrefs],
  );

  const handleBreakpointChange = useCallback((breakpoint: string) => {
    const cols = breakpoint === 'md' ? TABLET_COLS : COLS;
    activeColsRef.current = cols;
    setGridCols(cols);
  }, []);

  const reorderMobile = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const nextOrder = [...mobileOrderedIds];
      const fromIndex = nextOrder.indexOf(fromId);
      const toIndex = nextOrder.indexOf(toId);
      if (fromIndex < 0 || toIndex < 0) return;
      nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, fromId);
      const slots = new Map(
        mobileOrderedIds.map((key) => {
          const item = layout.find((entry) => entry.i === key);
          return [key, item ? { x: item.x, y: item.y } : { x: 0, y: 0 }];
        }),
      );
      const nextLayout = layout.map((item) => {
        const targetId = nextOrder[mobileOrderedIds.indexOf(item.i)];
        const slot = targetId ? slots.get(targetId) : undefined;
        return slot ? { ...item, x: slot.x, y: slot.y } : item;
      });
      commitPrefs(toSavedLayout(resolveLayout(nextLayout, COLS), COLS), hidden);
    },
    [mobileOrderedIds, layout, commitPrefs, hidden],
  );

  const resizeMobileWidget = useCallback(
    (key: string, delta: number) => {
      const parsed = parseLayoutKey(key);
      const definition = parsed ? getWidget(parsed.id) : undefined;
      const minH = definition?.defaultLayout.minH ?? 2;
      const maxH = definition?.defaultLayout.maxH ?? 10;
      const nextLayout = layout.map((item) =>
        item.i === key
          ? { ...item, h: Math.min(maxH, Math.max(minH, item.h + delta)) }
          : item,
      );
      commitPrefs(toSavedLayout(resolveLayout(nextLayout, COLS, key), COLS), hidden);
    },
    [layout, commitPrefs, hidden],
  );

  const setMobileWidgetHeight = useCallback(
    (key: string, height: number) => {
      const parsed = parseLayoutKey(key);
      const definition = parsed ? getWidget(parsed.id) : undefined;
      const minH = definition?.defaultLayout.minH ?? 2;
      const maxH = definition?.defaultLayout.maxH ?? 10;
      const nextLayout = layout.map((item) =>
        item.i === key ? { ...item, h: Math.min(maxH, Math.max(minH, height)) } : item,
      );
      commitPrefs(toSavedLayout(resolveLayout(nextLayout, COLS, key), COLS), hidden);
    },
    [layout, commitPrefs, hidden],
  );

  const removeLayoutItem = useCallback((key: string) => {
    const parsed = parseLayoutKey(key);
    if (!parsed) return;
    const saved = toSavedLayout(layout, COLS);
    if (parsed.instanceId) {
      const remaining = saved.filter((item) => layoutKey(item) !== key);
      const compacted = resolveLayout(buildLayout(orderedIds, remaining, hidden, false), COLS);
      commitPrefs(toSavedLayout(compacted, COLS), hidden);
      return;
    }
    const nextHidden = [...new Set([...hidden, parsed.id])];
    const remaining = saved.filter((item) => item.i !== parsed.id || Boolean(item.instanceId));
    const compacted = resolveLayout(buildLayout(orderedIds, remaining, nextHidden, false), COLS);
    commitPrefs(toSavedLayout(compacted, COLS), nextHidden);
  }, [layout, hidden, orderedIds, commitPrefs]);

  const duplicateLayoutItem = useCallback((key: string) => {
    const source = toSavedLayout(layout, COLS).find((item) => layoutKey(item) === key);
    if (!source) return;
    const duplicate: DashboardLayoutItem = { ...source, instanceId: crypto.randomUUID() };
    const nextLayout = buildLayout(orderedIds, [...toSavedLayout(layout, COLS), duplicate], hidden, false);
    commitPrefs(toSavedLayout(resolveLayout(nextLayout, COLS), COLS), hidden);
  }, [layout, orderedIds, hidden, commitPrefs]);

  const applySizePreset = useCallback((key: string, preset: '1x1' | '2x1' | '1x2' | '2x2') => {
    const cols = isMobile ? COLS : activeColsRef.current;
    const activeLayout = scaleLayout(layout, cols);
    const source = activeLayout.find((item) => item.i === key);
    if (!source) return;
    const halfWidth = Math.max(1, Math.floor(cols / 2));
    const dimensions = {
      '1x1': { w: halfWidth, h: 5 },
      '2x1': { w: cols, h: 5 },
      '1x2': { w: halfWidth, h: 10 },
      '2x2': { w: cols, h: 10 },
    }[preset];
    const nextActive = activeLayout.map((item) => item.i === key
      ? {
          ...item,
          w: Math.min(item.maxW ?? cols, Math.max(item.minW ?? 1, dimensions.w)),
          h: Math.min(item.maxH ?? 48, Math.max(item.minH ?? 1, dimensions.h)),
        }
      : item);
    const nextCanonical = toSavedLayout(resolveLayout(nextActive, cols, key), cols);
    const compacted = buildLayout(orderedIds, nextCanonical, hidden, false);
    commitPrefs(toSavedLayout(resolveLayout(compacted, COLS, key), COLS), hidden);
  }, [layout, orderedIds, hidden, commitPrefs, isMobile]);

  const handleMobileDragStart = (id: string, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    mobileDragRef.current = { id, pointerId: event.pointerId };
    mobileDropRef.current = id;
    setMobileDragId(id);
  };

  useEffect(() => {
    if (!mobileDragId) return;
    const resolveTarget = (x: number, y: number): string | null => {
      const value = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('[data-mobile-widget-id]')
        ?.dataset['mobileWidgetId'];
      return value && layout.some((item) => item.i === value)
        ? value
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
  }, [mobileDragId, layout, reorderMobile]);

  const moveMobileBy = (id: string, delta: number) => {
    const index = mobileOrderedIds.indexOf(id);
    const target = mobileOrderedIds[index + delta];
    if (target) reorderMobile(id, target);
  };

  const add = useCallback(
    (id: DashboardWidgetId) => {
      const nextHidden = hidden.filter((item) => item !== id);
      const built = buildLayout(orderedIds, prefs?.layout ?? [], nextHidden, (prefs?.layout.length ?? 0) === 0);
      const nextLayout = toSavedLayout(resolveLayout(built, COLS), COLS);
      commitPrefs(nextLayout, nextHidden);
      setPickerOpen(false);
    },
    [orderedIds, hidden, prefs?.layout, commitPrefs],
  );

  /** Reset restores the curated default, not "show every widget". */
  const reset = useCallback(() => {
    const nextHidden = availableIds.filter((id) => !defaultWidgets.includes(id));
    commitPrefs([], nextHidden);
    setEditing(false);
    setPickerOpen(false);
  }, [availableIds, defaultWidgets, commitPrefs]);

  const ctx: WidgetContext = { identity, userId: identity.user.id, onNavigate, refreshKey };
  const renderWidget = (Component: (props: { ctx: WidgetContext }) => React.JSX.Element): React.JSX.Element => {
    const content = <Component ctx={ctx} />;
    return isAdminDashboard
      ? <GlassSurface className="dashboard-admin-card">{content}</GlassSurface>
      : content;
  };
  const hiddenWidgets = available.filter((widget) => hidden.includes(widget.id));

  if (!prefs) {
    return (
      <WorkspacePageContainer className="dashboard-workspace">
        <section className="dashboard-command-bar">
          <div className="min-w-0">
            <h1>{isAdminDashboard ? 'Admin dashboard' : 'Today at a glance'}</h1>
            <p>{isAdminDashboard ? 'Preparing your operations overview…' : 'Preparing your workboard…'}</p>
          </div>
        </section>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((item) => <SkeletonCard key={item} className="h-36" />)}
        </div>
      </WorkspacePageContainer>
    );
  }

  return (
    <WorkspacePageContainer className={`dashboard-workspace ${isAdminDashboard ? 'dashboard-admin-mode' : ''}`}>
      <section className={isAdminDashboard ? 'dashboard-admin-hero' : 'dashboard-command-bar'}>
        <div className="min-w-0">
          {isAdminDashboard ? (
            <>
              <p className="dashboard-admin-eyebrow">COMPANY OPERATIONS</p>
              <h1>Admin dashboard</h1>
              <p>Workforce, sales and requests in one live view.</p>
            </>
          ) : (
            <>
              <h1>Today at a glance</h1>
              <p>{identity.user.fullName}&rsquo;s operational workboard</p>
            </>
          )}
        </div>
        <div className="ml-auto flex w-auto flex-wrap items-center justify-end gap-2">
            {isAdminDashboard && (
              <>
                <span className="dashboard-admin-date">{dashboardDate}</span>
                <button
                  type="button"
                  onClick={() => setRefreshKey((version) => version + 1)}
                  className="dashboard-admin-refresh"
                >
                  <Icon name="refresh" className="size-4" /> Refresh
                </button>
              </>
            )}
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
              aria-label={editing ? 'Finish dashboard customization' : 'Customize dashboard'}
              className="ui-primary inline-flex size-9 items-center justify-center rounded-lg px-0 py-0 text-xs font-semibold sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-2"
            >
              <Icon name={editing ? 'close' : 'edit'} className="size-4 sm:hidden" />
              <span className="hidden sm:inline">{editing ? 'Done' : 'Customize'}</span>
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

      {layout.length === 0 ? (
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
          {mobileOrderedIds.map((key) => {
            const parsed = parseLayoutKey(key);
            const def = parsed ? getWidget(parsed.id) : undefined;
            if (!def) return null;
            const Component = def.component;
            const layoutItem = layout.find((item) => item.i === key);
            const widgetHeight = Math.max(160, (layoutItem?.h ?? 3) * (ROW_HEIGHT + 16) - 16);
            return (
              <div
                key={key}
                data-mobile-widget-id={key}
                data-widget-id={parsed?.id ?? undefined}
                className={`mobile-dashboard-widget ${editing ? 'mobile-dashboard-widget-editing' : ''} ${mobileDragId === key ? 'mobile-dashboard-widget-dragging' : ''} ${mobileDropId === key && mobileDragId !== key ? 'mobile-dashboard-widget-drop-target' : ''}`}
                // Mobile widgets need a definite containing height even when
                // customization is off; the widget shells use h-full and
                // otherwise collapse/clip their content inside the card.
                style={{ height: `${widgetHeight}px` }}
              >
                {editing && (
                  <div className="mobile-dashboard-widget-controls mb-3 flex items-center justify-between gap-2 border-b border-app-border pb-2">
                    <button
                      type="button"
                      className="mobile-dashboard-drag-handle inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-app-muted"
                      aria-label={`Drag to reorder ${def.title}`}
                      title="Hold and drag to reorder"
                      onPointerDown={(event) => handleMobileDragStart(key, event)}
                    >
                      <Icon name="menu" className="size-4" />
                      <span>Move</span>
                    </button>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => moveMobileBy(key, -1)} disabled={mobileOrderedIds[0] === key} className="mobile-dashboard-control-button" aria-label={`Move ${def.title} up`} title="Move up">↑</button>
                      <button type="button" onClick={() => moveMobileBy(key, 1)} disabled={mobileOrderedIds[mobileOrderedIds.length - 1] === key} className="mobile-dashboard-control-button" aria-label={`Move ${def.title} down`} title="Move down">↓</button>
                      <span className="mx-1 h-5 w-px bg-app-border" />
                      {def.defaultLayout.resizable !== false && (
                        <>
                          <button type="button" onClick={() => resizeMobileWidget(key, -1)} disabled={(layoutItem?.h ?? 3) <= def.defaultLayout.minH} className="mobile-dashboard-control-button" aria-label={`Make ${def.title} shorter`} title="Shorter">−</button>
                          <button type="button" onClick={() => resizeMobileWidget(key, 1)} disabled={(layoutItem?.h ?? 3) >= (def.defaultLayout.maxH ?? 10)} className="mobile-dashboard-control-button" aria-label={`Make ${def.title} taller`} title="Taller">+</button>
                        </>
                      )}
                      <WidgetSettingsMenu
                        widgetKey={key}
                        title={def.title}
                        description={def.description}
                        cols={COLS}
                        minW={def.defaultLayout.minW}
                        minH={def.defaultLayout.minH}
                        maxW={def.defaultLayout.maxW ?? COLS}
                        maxH={def.defaultLayout.maxH ?? 48}
                        resizable={def.defaultLayout.resizable !== false}
                        onSize={applySizePreset}
                        onDuplicate={duplicateLayoutItem}
                        onRemove={removeLayoutItem}
                      />
                    </div>
                  </div>
                )}
                {editing && (
                  <label className="mobile-dashboard-size-control mb-3 flex items-center gap-3 text-xs font-semibold text-app-muted">
                    <span>Card height</span>
                    {def.defaultLayout.resizable !== false && (
                      <input
                        type="range"
                        min={def.defaultLayout.minH}
                        max={def.defaultLayout.maxH ?? 10}
                        step={1}
                        value={layoutItem?.h ?? 3}
                        onChange={(event) => setMobileWidgetHeight(key, Number(event.currentTarget.value))}
                        aria-label={`Card height for ${def.title}`}
                      />
                    )}
                  </label>
                )}
                <div className="mobile-dashboard-widget-content">
                  {renderWidget(Component)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`dashboard-grid mt-5 ${editing ? 'editing' : ''}`} data-columns={gridCols}>
          <ResponsiveGrid
            className="layout"
            layouts={{ lg: layout, md: scaleLayout(layout, TABLET_COLS) }}
            breakpoints={GRID_BREAKPOINTS}
            cols={GRID_COLS}
            rowHeight={ROW_HEIGHT}
            margin={[16, 16]}
            containerPadding={[0, 0]}
            compactType="vertical"
            preventCollision={false}
            allowOverlap={false}
            isBounded
            isDraggable={editing}
            isResizable={editing}
            resizeHandles={['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']}
            onBreakpointChange={handleBreakpointChange}
            onDragStop={handleGridInteractionStop}
            onResizeStop={handleGridInteractionStop}
            draggableHandle=".dashboard-widget-drag-handle"
            draggableCancel=".dashboard-widget-settings, .dashboard-widget-nodrag"
          >
            {layout.map((item) => {
              const parsed = parseLayoutKey(item.i);
              const def = parsed ? getWidget(parsed.id) : undefined;
              if (!def) return <div key={item.i} />;
              const Component = def.component;
              const isCopy = Boolean(parsed?.instanceId);
              return (
                <div key={item.i} className="dashboard-widget-frame" data-widget-id={parsed?.id ?? undefined}>
                  {editing && (
                    <div className="dashboard-widget-editbar">
                      <button
                        type="button"
                        className="dashboard-widget-drag-handle"
                        aria-label={`Drag ${def.title} widget`}
                        title="Drag to rearrange"
                      >
                        <Icon name="grip" className="size-3.5" />
                      </button>
                      {isCopy && <span className="dashboard-widget-copy-label">Copy</span>}
                      <WidgetSettingsMenu
                        widgetKey={item.i}
                        title={def.title}
                        description={def.description}
                        cols={gridCols}
                        minW={def.defaultLayout.minW}
                        minH={def.defaultLayout.minH}
                        maxW={def.defaultLayout.maxW ?? COLS}
                        maxH={def.defaultLayout.maxH ?? 48}
                        resizable={def.defaultLayout.resizable !== false}
                        onSize={applySizePreset}
                        onDuplicate={duplicateLayoutItem}
                        onRemove={removeLayoutItem}
                      />
                    </div>
                  )}
                  <div className={`dashboard-widget-content ${editing ? 'dashboard-widget-content-editing' : ''}`}>
                    {renderWidget(Component)}
                  </div>
                </div>
              );
            })}
          </ResponsiveGrid>
        </div>
      )}
    </WorkspacePageContainer>
  );
}
