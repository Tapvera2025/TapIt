import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Icon } from '../../ui/Icon.js';
import { Button, Modal } from './OrganizationUi.js';
import {
  filterPositionTree,
  flattenPositions,
  initialCollapsedPositions,
  matchesPosition,
  positionPath,
  canAddAbove,
  canMoveUnder,
} from './position-hierarchy-model.js';
import type { OrganizationDepartment, OrganizationPosition } from '../types/index.js';
import '../pages/org-chart.css';
import './position-hierarchy.css';

export type PositionPlacement = 'above' | 'beside' | 'below';
type PositionOffset = { x: number; y: number };
type PositionEdge = { id: string; path: string };

function loadOffsets(departmentId: string): Record<string, PositionOffset> {
  try {
    return JSON.parse(localStorage.getItem(`tapcrm.position-layout.${departmentId}`) ?? '{}') as Record<string, PositionOffset>;
  } catch {
    return {};
  }
}

export function PositionHierarchy({
  departments,
  departmentId,
  positions,
  onDepartmentChange,
  onEdit,
  onPolicies,
  onCreate,
  onMove,
}: {
  departments: OrganizationDepartment[];
  departmentId: string;
  positions: OrganizationPosition[];
  onDepartmentChange: (id: string) => void;
  onEdit: (position: OrganizationPosition) => void;
  onPolicies: (position: OrganizationPosition) => void;
  onCreate: (reference?: OrganizationPosition, placement?: PositionPlacement) => void;
  onMove: (position: OrganizationPosition, parent: OrganizationPosition) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'hierarchy' | 'list'>(() =>
    window.matchMedia('(max-width: 640px)').matches ? 'list' : 'hierarchy',
  );
  const [collapsed, setCollapsed] = useState(
    () => new Set(initialCollapsedPositions(positions)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, PositionOffset>>(() => loadOffsets(departmentId));
  const [edges, setEdges] = useState<PositionEdge[]>([]);
  const dragOrigin = useRef<{ id: string; x: number; y: number } | null>(null);
  const completedDrop = useRef(false);
  const [zoom, setZoom] = useState(100);
  const [fitView, setFitView] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLDivElement>(null);
  const flat = useMemo(() => flattenPositions(positions), [positions]);
  const filtered = useMemo(
    () => filterPositionTree(positions, query, status),
    [positions, query, status],
  );
  const matching = flat.filter((position) => matchesPosition(position, query, status));
  const filtering = Boolean(query.trim() || status);
  const department = departments.find((item) => item.id === departmentId);
  const selected = flat.find((position) => position.id === selectedId);
  const selectedPath = selected ? positionPath(selected, flat) : [];
  const holdersKnown = flat.every((position) => position.holderCount !== undefined);
  const people = flat.reduce((sum, position) => sum + (position.holderCount ?? 0), 0);
  const moveTargets = selected
    ? flat.filter((candidate) => canMoveUnder(selected, candidate, flat))
    : [];

  useLayoutEffect(() => {
    const container = viewport.current;
    const content = tree.current;
    if (!container || !content || !fitView) return;
    const fit = (): void =>
      setZoom(
        Math.max(
          1,
          Math.min(
            100,
            Math.floor(((container.clientWidth - 2) / content.offsetWidth) * 100),
          ),
        ),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, [filtered, collapsed, fitView, view]);

  useLayoutEffect(() => {
    const diagram = tree.current;
    if (!diagram || view !== 'hierarchy') return;
    const measure = (): void => {
      const scale = zoom / 100;
      const diagramRect = diagram.getBoundingClientRect();
      const cards = new Map(
        [...diagram.querySelectorAll<HTMLElement>('[data-position-card-id]')].map((card) => [card.dataset['positionCardId']!, card]),
      );
      const root = diagram.querySelector<HTMLElement>('.position-leadership');
      const relative = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return {
          x: (rect.left - diagramRect.left + rect.width / 2) / scale,
          top: (rect.top - diagramRect.top) / scale,
          bottom: (rect.bottom - diagramRect.top) / scale,
        };
      };
      setEdges(flat.flatMap((position) => {
        const child = cards.get(position.id);
        const parent = position.parentPositionId ? cards.get(position.parentPositionId) : root;
        if (!child || !parent) return [];
        const start = relative(parent);
        const end = relative(child);
        const bend = Math.max(24, Math.abs(end.top - start.bottom) / 2);
        return [{ id: position.id,
          path: `M ${start.x} ${start.bottom} C ${start.x} ${start.bottom + bend} ${end.x} ${end.top - bend} ${end.x} ${end.top}` }];
      }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(diagram);
    const onFonts = (): void => measure();
    void document.fonts.ready.then(onFonts);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [flat, filtered, collapsed, offsets, zoom, view]);

  function toggle(id: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function changeZoom(delta: number): void {
    setFitView(false);
    setZoom((value) => Math.max(25, Math.min(140, value + delta)));
  }
  function navigatePositions(event: KeyboardEvent<HTMLDivElement>): void {
    if (
      !(event.target instanceof HTMLButtonElement) ||
      !event.target.dataset['positionId']
    )
      return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[data-position-id]',
      ),
    ];
    const index = buttons.indexOf(event.target);
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown')
      next = buttons[Math.min(buttons.length - 1, index + 1)];
    else if (event.key === 'ArrowUp') next = buttons[Math.max(0, index - 1)];
    else if (event.key === 'Home') next = buttons[0];
    else if (event.key === 'End') next = buttons[buttons.length - 1];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }
  function clearFilters(): void {
    setQuery('');
    setStatus('');
  }
  function selectPosition(id: string): void {
    setMoveTargetId('');
    setSelectedId(id);
  }
  function dragStart(event: DragEvent<HTMLDivElement>): void {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-position-card-id]');
    const id = card?.dataset['positionCardId'];
    const source = flat.find((position) => position.id === id);
    if (!source || source.isSeeded) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', source.id);
    dragOrigin.current = { id: source.id, x: event.clientX, y: event.clientY };
    completedDrop.current = false;
    setDraggedId(source.id);
    setDropId(null);
  }
  function dragOver(event: DragEvent<HTMLDivElement>): void {
    if (!draggedId) return;
    event.preventDefault();
    const targetId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-position-card-id]')?.dataset['positionCardId'];
    const source = flat.find((position) => position.id === draggedId);
    const target = flat.find((position) => position.id === targetId);
    if (source && target && canMoveUnder(source, target, flat)) {
      event.dataTransfer.dropEffect = 'move';
      if (dropId !== target.id) setDropId(target.id);
    } else {
      event.dataTransfer.dropEffect = target ? 'none' : 'move';
      if (dropId) setDropId(null);
    }
  }
  function placeBlock(id: string, clientX: number, clientY: number): void {
    const origin = dragOrigin.current;
    if (!origin || origin.id !== id || !clientX || !clientY) return;
    const scale = zoom / 100;
    const deltaX = (clientX - origin.x) / scale;
    const deltaY = (clientY - origin.y) / scale;
    if (Math.abs(deltaX) + Math.abs(deltaY) < 8) return;
    setOffsets((current) => {
      const previous = current[id] ?? { x: 0, y: 0 };
      const next = { ...current, [id]: { x: Math.round(previous.x + deltaX), y: Math.round(previous.y + deltaY) } };
      localStorage.setItem(`tapcrm.position-layout.${departmentId}`, JSON.stringify(next));
      return next;
    });
  }
  function drop(event: DragEvent<HTMLDivElement>): void {
    const targetId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-position-card-id]')?.dataset['positionCardId'];
    const source = flat.find((position) => position.id === draggedId);
    const target = flat.find((position) => position.id === targetId);
    if (source && target && canMoveUnder(source, target, flat)) {
      event.preventDefault();
      completedDrop.current = true;
      onMove(source, target);
    } else if (source && !target) {
      event.preventDefault();
      completedDrop.current = true;
      placeBlock(source.id, event.clientX, event.clientY);
    } else if (target) {
      completedDrop.current = true;
    }
    setDraggedId(null);
    setDropId(null);
  }
  function dragEnd(event: DragEvent<HTMLDivElement>): void {
    if (!completedDrop.current && dragOrigin.current && !dropId) {
      placeBlock(dragOrigin.current.id, event.clientX, event.clientY);
    }
    dragOrigin.current = null;
    completedDrop.current = false;
    setDraggedId(null);
    setDropId(null);
  }

  return (
    <section className="org-chart position-explorer mt-6" aria-label="Position explorer">
      <div className="org-chart-overview">
        <div className="org-chart-overview-title">
          <h2>{department?.name ?? 'Department'} hierarchy</h2>
          <p>See how positions connect and manage what each role can do.</p>
        </div>
        <dl className="org-chart-metrics">
          <div className="org-chart-metric">
            <dt>Positions</dt>
            <dd>{flat.length}</dd>
          </div>
          <div className="org-chart-metric">
            <dt>Assigned people</dt>
            <dd>{holdersKnown ? people : '—'}</dd>
          </div>
          <div className="org-chart-metric">
            <dt>Levels</dt>
            <dd>{new Set(flat.map((position) => position.organizationalLevel)).size}</dd>
          </div>
        </dl>
      </div>
      <div className="position-toolbar">
        <label className="position-department-select">
          <span>Department</span>
          <select
            value={departmentId}
            onChange={(event) => onDepartmentChange(event.target.value)}
          >
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="org-chart-search">
          <Icon name="search" className="size-4 shrink-0" />
          <span className="sr-only">Find a position by name or code</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a position by name or code…"
          />
        </label>
        <label className="position-status-select">
          <span className="sr-only">Position status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <div className="position-view-toggle" role="group" aria-label="Position view">
          <button
            type="button"
            aria-pressed={view === 'hierarchy'}
            onClick={() => setView('hierarchy')}
          >
            Hierarchy
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
      </div>
      {filtering && (
        <div className="org-chart-results" role="status">
          <span>
            {matching.length} matching {matching.length === 1 ? 'position' : 'positions'}
            {view === 'hierarchy' ? ' · Parent positions stay visible' : ''}
          </span>
          <button type="button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}
      {flat.length === 0 ? (
        <div className="position-empty">
          <h3>Build your department hierarchy</h3>
          <p>Add the first position at the top, then create the roles beneath it.</p>
          <Button onClick={() => onCreate()}>Add first position</Button>
        </div>
      ) : matching.length === 0 ? (
        <div className="position-empty">
          <h3>No matching positions</h3>
          <p>Try a different name, code, or status.</p>
          <Button kind="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          {view === 'hierarchy' ? (
            <>
              <div className="position-canvas-toolbar">
                <p>Drag a block onto another to change its parent. Drop on open canvas to arrange it.</p>
                <div className="position-tree-actions">
                  {Object.keys(offsets).length > 0 && (
                    <button type="button" onClick={() => {
                      setOffsets({});
                      localStorage.removeItem(`tapcrm.position-layout.${departmentId}`);
                    }}>Reset layout</button>
                  )}
                  <button
                    type="button"
                    disabled={filtering}
                    onClick={() => setCollapsed(new Set())}
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    disabled={filtering}
                    onClick={() =>
                      setCollapsed(
                        new Set(
                          flat
                            .filter((item) => item.children?.length)
                            .map((item) => item.id),
                        ),
                      )
                    }
                  >
                    Collapse all
                  </button>
                </div>
                <div className="org-chart-zoom" role="group" aria-label="Hierarchy zoom">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    disabled={zoom <= 25}
                    onClick={() => changeZoom(-10)}
                  >
                    −
                  </button>
                  <output aria-label="Zoom level">{zoom}%</output>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    disabled={zoom >= 140}
                    onClick={() => changeZoom(10)}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="org-chart-fit"
                    aria-label="Fit hierarchy to view"
                    aria-pressed={fitView}
                    onClick={() => {
                      setFitView(true);
                      viewport.current?.scrollTo({ left: 0, top: 0 });
                    }}
                  >
                    <Icon name="fit" className="size-4" /> Fit
                  </button>
                </div>
              </div>
              <div
                className="position-viewport"
                ref={viewport}
                role="region"
                tabIndex={0}
                aria-label="Position hierarchy. Use Tab or the up and down arrow keys to move between positions, and Enter to open details."
                onDragStart={dragStart}
                onDragOver={dragOver}
                onDrop={drop}
                onDragEnd={dragEnd}
              >
                <div
                  className="position-diagram"
                  ref={tree}
                  style={{ zoom: zoom / 100 }}
                  onKeyDown={navigatePositions}
                >
                  <svg className="position-connectors" aria-hidden="true">
                    {edges.map((edge) => <path key={edge.id} d={edge.path} />)}
                  </svg>
                  <div className="position-leadership">
                    <span>ORGANIZATION LEADERSHIP</span>
                    <h3>Super Admin</h3>
                  </div>
                  <ul
                    className="position-tree-level"
                    aria-label={`${department?.name ?? 'Department'} positions`}
                  >
                    {filtered.map((position) => (
                      <PositionNode
                        key={position.id}
                        position={position}
                        collapsed={collapsed}
                        filtering={filtering}
                        query={query}
                        status={status}
                        onToggle={toggle}
                        onSelect={selectPosition}
                        onCreate={onCreate}
                        draggedId={draggedId}
                        dropId={dropId}
                        positions={flat}
                        offsets={offsets}
                      />
                    ))}
                  </ul>
                </div>
              </div>
            </>
          ) : (
            <ul className="position-directory" aria-label="Positions list">
              {matching.map((position) => (
                <li key={position.id}>
                  <button
                    type="button"
                    className="position-directory-row"
                    onClick={() => selectPosition(position.id)}
                    aria-label={`View ${position.name} details`}
                  >
                    <span className="position-directory-name">
                      <strong>{position.name}</strong>
                      <span>
                        {position.code} · Under{' '}
                        {flat.find((item) => item.id === position.parentPositionId)
                          ?.name ??
                          (position.parentPositionId
                            ? 'Unavailable parent'
                            : 'Super Admin')}
                      </span>
                    </span>
                    <span className="position-level">
                      Level {position.organizationalLevel}
                    </span>
                    <span className="position-directory-people">
                      {holderLabel(position.holderCount)}
                    </span>
                    <PositionStatus status={position.status} />
                    <Icon name="arrow" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="position-explorer-footer">
            <span>
              Select a position to add nearby roles, move it, edit it, or manage policies.
            </span>
            <span>Higher level = more senior</span>
          </div>
        </>
      )}
      {selected && (
        <Modal
          title={selected.name}
          dirty={false}
          onClose={() => setSelectedId(null)}
          footer={
            <div className="position-detail-actions">
              <Button
                kind="secondary"
                onClick={() => {
                  setSelectedId(null);
                  onEdit(selected);
                }}
              >
                Edit position
              </Button>
              <Button
                onClick={() => {
                  setSelectedId(null);
                  onPolicies(selected);
                }}
              >
                Manage policies
              </Button>
            </div>
          }
        >
          <nav className="position-path" aria-label="Position hierarchy path">
            <span>Super Admin</span>
            {selectedPath.map((item) => (
              <span key={item.id}>
                <span aria-hidden="true">/</span>
                {item.name}
              </span>
            ))}
          </nav>
          <div className="position-detail-heading">
            <span className="position-level">Level {selected.organizationalLevel}</span>
            <PositionStatus status={selected.status} />
            <code>{selected.code}</code>
          </div>
          <dl className="position-detail-facts">
            <div>
              <dt>Department</dt>
              <dd>{department?.name ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Parent position</dt>
              <dd>
                {flat.find((item) => item.id === selected.parentPositionId)?.name ??
                  (selected.parentPositionId ? 'Outside this view' : 'Super Admin')}
              </dd>
            </div>
            <div>
              <dt>Assigned people</dt>
              <dd>{selected.holderCount ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Direct child positions</dt>
              <dd>{selected.children?.length ?? 0}</dd>
            </div>
          </dl>
          <section className="position-detail-manage" aria-label="Add and move positions">
            <h3>Build around this position</h3>
            <div className="position-detail-create">
              <Button kind="secondary" disabled={!canAddAbove(selected, flat)} onClick={() => {
                setSelectedId(null);
                onCreate(selected, 'above');
              }}>Add above</Button>
              <Button kind="secondary" disabled={!selected.parentPositionId} onClick={() => {
                setSelectedId(null);
                onCreate(selected, 'beside');
              }}>Add alongside</Button>
              <Button kind="secondary" disabled={selected.status !== 'active' || selected.organizationalLevel <= 1} onClick={() => {
                setSelectedId(null);
                onCreate(selected, 'below');
              }}>Add below</Button>
            </div>
            <p>Above inserts a new parent; alongside shares this position’s parent; below creates a child.</p>
            {!selected.isSeeded && moveTargets.length > 0 && (
              <div className="position-move-form">
                <label htmlFor={`position-move-${selected.id}`}>Move under</label>
                <select id={`position-move-${selected.id}`} value={moveTargetId} onChange={(event) => setMoveTargetId(event.target.value)}>
                  <option value="">Choose a new parent…</option>
                  {moveTargets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · Level {candidate.organizationalLevel}</option>)}
                </select>
                <Button kind="secondary" disabled={!moveTargetId} onClick={() => {
                  const parent = moveTargets.find((candidate) => candidate.id === moveTargetId);
                  if (!parent) return;
                  setSelectedId(null);
                  onMove(selected, parent);
                }}>Review move</Button>
              </div>
            )}
            {selected.isSeeded && <p>This built-in position’s place in the hierarchy is fixed.</p>}
          </section>
          <section className="position-detail-children">
            <h3>Positions directly below</h3>
            {selected.children?.length ? (
              <ul>
                {selected.children.map((child) => (
                  <li key={child.id}>
                    <span>{child.name}</span>
                    <span>Level {child.organizationalLevel}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No positions sit directly below this role.</p>
            )}
          </section>
          <p className="position-detail-note">
            Policies control what people assigned to this position can access and do. The
            level shows its seniority in this department.
          </p>
          {selected.organizationalLevel <= 1 && (
            <p className="position-detail-note">
              Level 1 is the lowest level. A position cannot be added below it.
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}

function holderLabel(count: number | undefined): string {
  return count === undefined
    ? 'People unavailable'
    : count === 0
      ? 'Unfilled'
      : `${count} ${count === 1 ? 'person' : 'people'}`;
}
function PositionStatus({ status }: { status: string }): React.JSX.Element {
  return (
    <span
      className={`position-status${status === 'active' ? ' position-status-active' : ''}`}
    >
      {status === 'active' ? 'Active' : 'Inactive'}
    </span>
  );
}
function PositionNode({
  position,
  collapsed,
  filtering,
  query,
  status,
  onToggle,
  onSelect,
  onCreate,
  draggedId,
  dropId,
  positions,
  offsets,
}: {
  position: OrganizationPosition;
  collapsed: Set<string>;
  filtering: boolean;
  query: string;
  status: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onCreate: (reference: OrganizationPosition, placement: PositionPlacement) => void;
  draggedId: string | null;
  dropId: string | null;
  positions: readonly OrganizationPosition[];
  offsets: Readonly<Record<string, PositionOffset>>;
}): React.JSX.Element {
  const children = position.children ?? [];
  const open = filtering || !collapsed.has(position.id);
  const context = filtering && !matchesPosition(position, query, status);
  return (
    <li className="position-tree-node">
      <div className="position-node-shell" style={{ transform: `translate(${offsets[position.id]?.x ?? 0}px, ${offsets[position.id]?.y ?? 0}px)` }}>
        <div
          data-position-card-id={position.id}
          draggable={!position.isSeeded}
          title={position.isSeeded ? undefined : 'Drag this block onto a new parent or empty canvas'}
          className={`position-node-card${context ? ' position-node-context' : ''}${position.status !== 'active' ? ' position-node-inactive' : ''}${dropId === position.id ? ' position-node-drop-target' : ''}${draggedId === position.id ? ' position-node-dragging' : ''}`}
        >
          <button
            type="button"
            className="position-node-select"
            data-position-id={position.id}
            onClick={() => onSelect(position.id)}
            aria-label={`View ${position.name} details, level ${position.organizationalLevel}, ${position.status}`}
          >
            <span className="position-node-meta">
              <span className="position-level">Level {position.organizationalLevel}</span>
              <PositionStatus status={position.status} />
            </span>
            <strong>{position.name}</strong>
            <span className="position-node-code">{position.code}</span>
            <span className="position-node-people">
              {holderLabel(position.holderCount)}
              {context && <span>Parent context</span>}
            </span>
          </button>
          {children.length > 0 && (
            <button
              type="button"
              className="position-node-expand"
              aria-expanded={open}
              aria-controls={`position-children-${position.id}`}
              aria-label={`${open ? 'Collapse' : 'Expand'} positions below ${position.name}`}
              disabled={filtering}
              onClick={() => onToggle(position.id)}
            >
              <span>
                {children.length} {filtering ? 'shown' : 'direct'}{' '}
                {children.length === 1 ? 'position' : 'positions'}
              </span>
              <Icon name={open ? 'chevron-up' : 'chevron-down'} className="size-4" />
            </button>
          )}
        </div>
        <div className="position-node-quick-add" role="group" aria-label={`Add a position around ${position.name}`}>
          <button type="button" className="position-node-add-above" disabled={!canAddAbove(position, positions)} title={canAddAbove(position, positions) ? `Add a parent above ${position.name}` : 'No available level for a parent here'} aria-label={`Add position above ${position.name}`} onClick={() => onCreate(position, 'above')}><Icon name="plus" className="size-3" /></button>
          <button type="button" className="position-node-add-beside" disabled={!position.parentPositionId} title={position.parentPositionId ? `Add alongside ${position.name}` : 'The department already has a top position'} aria-label={`Add position alongside ${position.name}`} onClick={() => onCreate(position, 'beside')}><Icon name="plus" className="size-3" /></button>
          <button type="button" className="position-node-add-below" disabled={position.status !== 'active' || position.organizationalLevel <= 1} title={position.organizationalLevel <= 1 ? 'Level 1 cannot have a child position' : `Add below ${position.name}`} aria-label={`Add position below ${position.name}`} onClick={() => onCreate(position, 'below')}><Icon name="plus" className="size-3" /></button>
        </div>
      </div>
      {children.length > 0 && open && (
        <ul
          className="position-tree-level"
          id={`position-children-${position.id}`}
          aria-label={`Positions below ${position.name}`}
        >
          {children.map((child) => (
            <PositionNode
              key={child.id}
              position={child}
              collapsed={collapsed}
              filtering={filtering}
              query={query}
              status={status}
              onToggle={onToggle}
              onSelect={onSelect}
              onCreate={onCreate}
              draggedId={draggedId}
              dropId={dropId}
              positions={positions}
              offsets={offsets}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
