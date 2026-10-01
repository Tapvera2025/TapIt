import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { organizationApi } from '../api/organizationApi.js';
import {
  Button,
  Empty,
  ErrorMessage,
  Loading,
  Modal,
  Notice,
  Page,
  Select,
} from '../components/OrganizationUi.js';
import {
  buildReportingForest,
  filterReportingForest,
  matchesPerson,
  type ReportingNode,
} from '../components/org-chart-model.js';
import { Icon } from '../../ui/Icon.js';
import type {
  OrganizationChart,
  OrganizationChartDepartment,
  OrganizationEmployee,
  ReportingManagerCandidate,
  ReportingPreview,
} from '../types/index.js';
import './org-chart.css';

const EMPTY_CHART: OrganizationChart = { people: [], departments: [] };
const POSITION_DEFAULT = 'position-default';

export function OrgChartPage(): React.JSX.Element {
  const [chart, setChart] = useState<OrganizationChart | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<OrganizationEmployee | null>(null);
  const [draggingPersonId, setDraggingPersonId] = useState<string | null>(null);
  const [dragCandidates, setDragCandidates] = useState<ReportingManagerCandidate[]>([]);
  const [dragLoading, setDragLoading] = useState(false);
  const [dragError, setDragError] = useState<unknown>(null);
  const dragRequest = useRef(0);
  const [moveSource, setMoveSource] = useState<OrganizationEmployee | null>(null);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moveCandidates, setMoveCandidates] = useState<ReportingManagerCandidate[]>([]);
  const [moveCandidatesLoading, setMoveCandidatesLoading] = useState(false);
  const [movePreview, setMovePreview] = useState<ReportingPreview | null>(null);
  const [movePreviewLoading, setMovePreviewLoading] = useState(false);
  const [moveSubmitting, setMoveSubmitting] = useState(false);
  const [moveError, setMoveError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const moveSession = useRef(0);
  const previewRequest = useRef(0);
  const [zoom, setZoom] = useState(100);
  const [fitView, setFitView] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void organizationApi
      .chart()
      .then((data) => {
        if (!cancelled) setChart(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const data = chart ?? EMPTY_CHART;
  const forest = useMemo(() => buildReportingForest(data.people), [data.people]);
  const filtered = useMemo(
    () => filterReportingForest(forest, query, departmentId),
    [forest, query, departmentId],
  );
  const filtering = Boolean(query.trim() || departmentId);
  const matches = data.people.filter((person) =>
    matchesPerson(person, query, departmentId),
  ).length;
  const teams = new Set(data.people.map((person) => person.teamId).filter(Boolean)).size;
  const branches = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        name: string;
        department?: OrganizationChartDepartment;
        nodes: ReportingNode[];
      }
    >();
    for (const department of data.departments) {
      if (!filtering || (!query.trim() && department.id === departmentId)) {
        groups.set(department.id, {
          id: department.id,
          name: department.name,
          department,
          nodes: [],
        });
      }
    }
    for (const node of filtered) {
      const id = node.person.departmentId ?? 'unassigned';
      let group = groups.get(id);
      if (!group) {
        const department = data.departments.find((item) => item.id === id);
        group = {
          id,
          name: department?.name ?? node.person.departmentName ?? 'Unassigned department',
          ...(department ? { department } : {}),
          nodes: [],
        };
        groups.set(id, group);
      }
      group.nodes.push(node);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.departments, filtered, filtering, query, departmentId]);

  useLayoutEffect(() => {
    const container = viewport.current;
    const content = tree.current;
    if (!container || !content || !fitView) return;
    const fit = (): void => {
      setZoom(
        Math.max(
          1,
          Math.min(
            100,
            Math.floor(((container.clientWidth - 2) / content.offsetWidth) * 100),
          ),
        ),
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, [loading, branches, fitView]);

  function toggle(id: string): void {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function fitChart(): void {
    setFitView(true);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  }

  function changeZoom(amount: number): void {
    setFitView(false);
    setZoom((value) => Math.max(25, Math.min(140, value + amount)));
  }

  function closeMove(): void {
    ++moveSession.current;
    ++previewRequest.current;
    setMoveSource(null);
    setMovePreview(null);
    setMoveError(null);
  }

  async function previewReportingChange(
    person: OrganizationEmployee,
    targetId: string,
  ): Promise<void> {
    const session = moveSession.current;
    const request = ++previewRequest.current;
    setMovePreview(null);
    setMoveError(null);
    setMovePreviewLoading(true);
    try {
      const preview = await organizationApi.previewManagerReassignment(
        person.id,
        targetId === POSITION_DEFAULT ? null : targetId,
        'individual',
      );
      if (session === moveSession.current && request === previewRequest.current) {
        setMovePreview(preview);
      }
    } catch (cause) {
      if (session === moveSession.current && request === previewRequest.current) {
        setMoveError(cause);
      }
    } finally {
      if (session === moveSession.current && request === previewRequest.current) {
        setMovePreviewLoading(false);
      }
    }
  }

  function openMove(person: OrganizationEmployee, targetId = ''): void {
    if (!person.departmentId || !person.positionId) return;
    const session = ++moveSession.current;
    ++previewRequest.current;
    setMoveSource(person);
    setMoveTargetId(targetId);
    setMoveCandidates([]);
    setMovePreview(null);
    setMovePreviewLoading(false);
    setMoveError(null);
    setMoveCandidatesLoading(true);
    void organizationApi
      .reportingManagers(
        person.departmentId,
        person.positionId,
        person.id,
        person.teamId ?? undefined,
      )
      .then((candidates) => {
        if (session === moveSession.current) setMoveCandidates(candidates);
      })
      .catch((cause: unknown) => {
        if (session === moveSession.current) setMoveError(cause);
      })
      .finally(() => {
        if (session === moveSession.current) setMoveCandidatesLoading(false);
      });
    if (targetId) void previewReportingChange(person, targetId);
  }

  async function applyMove(): Promise<void> {
    if (!moveSource || !movePreview || !moveTargetId || moveSubmitting) return;
    const person = moveSource;
    const managerId = moveTargetId === POSITION_DEFAULT ? null : moveTargetId;
    const managerName = movePreview.proposedManager?.fullName ?? 'the position default';
    const session = moveSession.current;
    setMoveSubmitting(true);
    setMoveError(null);
    try {
      await organizationApi.reassignManager(person.id, managerId);
    } catch (cause) {
      if (session === moveSession.current) {
        setMoveError(cause);
        setMovePreview(null);
      }
      setMoveSubmitting(false);
      return;
    }
    try {
      const next = await organizationApi.chart();
      setChart(next);
      setMessage(`${person.fullName} now reports to ${managerName}.`);
    } catch {
      setMessage(
        `${person.fullName}'s reporting line was saved, but the chart could not refresh. Reload the page to see the change.`,
      );
    } finally {
      closeMove();
      setSelected(null);
      setMoveSubmitting(false);
    }
  }

  function startDrag(person: OrganizationEmployee, event: DragEvent<HTMLElement>): void {
    if (!person.departmentId || !person.positionId) {
      event.preventDefault();
      return;
    }
    const request = ++dragRequest.current;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', person.id);
    setDraggingPersonId(person.id);
    setDragCandidates([]);
    setDragError(null);
    setDragLoading(true);
    void organizationApi
      .reportingManagers(
        person.departmentId,
        person.positionId,
        person.id,
        person.teamId ?? undefined,
      )
      .then((candidates) => {
        if (request === dragRequest.current) setDragCandidates(candidates);
      })
      .catch((cause: unknown) => {
        if (request === dragRequest.current) setDragError(cause);
      })
      .finally(() => {
        if (request === dragRequest.current) setDragLoading(false);
      });
  }

  function endDrag(): void {
    ++dragRequest.current;
    setDraggingPersonId(null);
    setDragCandidates([]);
    setDragLoading(false);
  }

  const dragSource = data.people.find((person) => person.id === draggingPersonId);
  const dropIds = new Set(dragCandidates.map((candidate) => candidate.id));
  const rootCandidate = dragCandidates.find(
    (candidate) => candidate.accountType === 'super-admin',
  );
  function allowDrop(event: DragEvent<HTMLElement>, targetId: string): void {
    event.stopPropagation();
    if (!dragSource || !dropIds.has(targetId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }
  function dropOn(event: DragEvent<HTMLElement>, targetId: string): void {
    event.stopPropagation();
    if (!dragSource || !dropIds.has(targetId)) return;
    event.preventDefault();
    const person = dragSource;
    endDrag();
    openMove(person, targetId);
  }

  return (
    <Page
      eyebrow="Organization"
      title="Organization chart"
      description="Leadership, departments, and reporting relationships."
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <div className="mt-6 space-y-3">
          <ErrorMessage cause={error} />
          <Button kind="secondary" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        </div>
      ) : data.people.length === 0 && data.departments.length === 0 ? (
        <Empty>
          Your organization chart will appear here when departments and people are
          available.
        </Empty>
      ) : (
        <section className="org-chart mt-6" aria-label="Organization hierarchy">
          {message && (
            <div className="org-chart-message">
              <Notice>{message}</Notice>
            </div>
          )}
          <div className="org-chart-overview">
            <div className="org-chart-overview-title">
              <h2>Reporting structure</h2>
              <p>Explore departments and the people behind them.</p>
            </div>
            <dl className="org-chart-metrics">
              <Metric label="Departments" value={data.departments.length} />
              <Metric label="Visible people" value={data.people.length} />
              <Metric label="Visible teams" value={teams} />
            </dl>
          </div>

          <div className="org-chart-toolbar">
            <label className="org-chart-search">
              <Icon name="search" className="size-4 shrink-0" />
              <span className="sr-only">Search people, roles, or teams</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search people, roles, or teams…"
              />
            </label>
            <label className="org-chart-filter">
              <span className="sr-only">Filter by department</span>
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">All departments</option>
                {data.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="org-chart-expand-actions">
              <button
                type="button"
                onClick={() => setCollapsed(new Set())}
                disabled={filtering}
              >
                Expand all
              </button>
              <span aria-hidden="true" />
              <button
                type="button"
                onClick={() =>
                  setCollapsed(
                    new Set(branches.map((branch) => `department:${branch.id}`)),
                  )
                }
                disabled={filtering}
              >
                Collapse all
              </button>
            </div>
          </div>

          {filtering && (
            <div className="org-chart-results" role="status">
              <span>
                {matches} matching {matches === 1 ? 'person' : 'people'} · Reporting paths
                stay visible
              </span>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setDepartmentId('');
                }}
              >
                Clear filters <span aria-hidden="true">×</span>
              </button>
            </div>
          )}

          {branches.length === 0 ? (
            <div className="org-chart-no-results">
              <Icon name="search" className="mx-auto mb-3 size-7" />
              <h3>No matching people</h3>
              <p>Try another name, role, or team, or clear your filters.</p>
            </div>
          ) : (
            <div
              className="org-chart-viewport"
              ref={viewport}
              tabIndex={0}
              role="region"
              aria-label="Scrollable organization tree. Scroll horizontally to explore departments."
            >
              <div className="org-chart-tree" ref={tree} style={{ zoom: zoom / 100 }}>
                <div
                  className={`org-chart-root${draggingPersonId && rootCandidate ? ' org-chart-root-drop-target' : ''}`}
                  onDragOver={(event) => {
                    if (rootCandidate) allowDrop(event, rootCandidate.id);
                  }}
                  onDrop={(event) => {
                    if (rootCandidate) dropOn(event, rootCandidate.id);
                  }}
                >
                  <div>
                    <span className="org-chart-kicker">LEADERSHIP</span>
                    <h3>Super Admin</h3>
                    <p>Organization oversight</p>
                  </div>
                </div>
                <ul className="org-chart-branches" aria-label="Department branches">
                  {branches.map((branch) => {
                    const branchKey = `department:${branch.id}`;
                    const open = filtering || !collapsed.has(branchKey);
                    const count = data.people.filter(
                      (person) =>
                        person.departmentId ===
                        (branch.id === 'unassigned' ? null : branch.id),
                    ).length;
                    return (
                      <li
                        className="org-chart-branch"
                        key={branch.id}
                        style={{
                          width: Math.max(276, 216 + reportingDepth(branch.nodes) * 26),
                        }}
                      >
                        <div className="org-chart-department">
                          <div className="org-chart-department-top">
                            <span className="org-chart-kicker">DEPARTMENT</span>
                            <span
                              className="org-chart-count"
                              aria-label={
                                branch.department?.structureOnly && count === 0
                                  ? 'People restricted'
                                  : `${count} visible people`
                              }
                            >
                              {branch.department?.structureOnly && count === 0
                                ? 'Restricted'
                                : `${count} ${count === 1 ? 'person' : 'people'}`}
                            </span>
                          </div>
                          <h3>{branch.name}</h3>
                          <p>
                            {branch.department?.headPositionNames.join(' · ') ||
                              'Department structure'}
                          </p>
                          {branch.nodes.length > 0 ? (
                            <button
                              type="button"
                              className="org-chart-department-toggle"
                              aria-expanded={open}
                              aria-controls={`branch-${branch.id}`}
                              onClick={() => toggle(branchKey)}
                              disabled={filtering}
                            >
                              <span>{open ? 'Hide people' : 'Show people'}</span>
                              <Icon
                                name={open ? 'chevron-up' : 'chevron-down'}
                                className="size-4"
                              />
                            </button>
                          ) : (
                            <div className="org-chart-department-empty">
                              {branch.department?.structureOnly
                                ? 'Structure only · People restricted'
                                : filtering
                                  ? 'No matching people'
                                  : 'No visible people yet'}
                            </div>
                          )}
                        </div>
                        {open && branch.nodes.length > 0 && (
                          <ul
                            className="org-chart-people"
                            id={`branch-${branch.id}`}
                            aria-label={`${branch.name} reporting relationships`}
                          >
                            {branch.nodes.map((node) => (
                              <PersonNode
                                key={node.person.id}
                                node={node}
                                collapsed={collapsed}
                                filtering={filtering}
                                query={query}
                                departmentId={departmentId}
                                onToggle={toggle}
                                onSelect={setSelected}
                                onMove={openMove}
                                onDragStart={startDrag}
                                onDragEnd={endDrag}
                                onDragOver={allowDrop}
                                onDrop={dropOn}
                                draggingPersonId={draggingPersonId}
                                dropIds={dropIds}
                              />
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          <div className="org-chart-footer">
            <div className="org-chart-legend">
              <span>
                <i className="org-chart-structure-line" />
                Department structure
              </span>
              <span>
                <i className="org-chart-reporting-line" />
                Reporting line
              </span>
            </div>
            <div className="org-chart-zoom" role="group" aria-label="Chart zoom">
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
                onClick={fitChart}
                aria-pressed={fitView}
                aria-label="Fit chart to view"
                disabled={branches.length === 0}
              >
                <Icon name="fit" className="size-4" /> Fit
              </button>
            </div>
          </div>
          <p className="org-chart-hint" role="status">
            {draggingPersonId
              ? dragLoading
                ? 'Finding valid managers…'
                : `Drop ${dragSource?.fullName ?? 'this person'} on a highlighted manager to preview the change.`
              : 'Drag a person onto a highlighted manager, or use Change manager on a card. Every change needs confirmation.'}
          </p>
          {Boolean(dragError) && (
            <div className="org-chart-drag-error">
              <ErrorMessage cause={dragError} />
            </div>
          )}
        </section>
      )}
      {selected && (
        <Modal title={selected.fullName} onClose={() => setSelected(null)}>
          <div className="org-chart-person-detail">
            <span className="org-chart-avatar">{initials(selected.fullName)}</span>
            <div>
              <p className="font-semibold">
                {selected.positionName ?? 'No position assigned'}
              </p>
              <p className="mt-1 text-sm text-app-muted">
                {selected.departmentName ?? 'No department assigned'}
              </p>
            </div>
          </div>
          <dl className="org-chart-detail-grid">
            {[
              ['Department', selected.departmentName ?? 'Not assigned'],
              [
                'Position',
                `${selected.positionName ?? 'Not assigned'}${selected.positionCode ? ` (${selected.positionCode})` : ''}`,
              ],
              ['Team', selected.teamName ?? 'Not assigned'],
              [
                'Reports to',
                selected.reportsToName ??
                  data.people.find(
                    (person) =>
                      person.id === (selected.reportsTo ?? selected.effectiveManagerId),
                  )?.fullName ??
                  (selected.reportsTo || selected.effectiveManagerId
                    ? 'Manager outside this view'
                    : 'Not assigned'),
              ],
              ['Designation', selected.designationName ?? 'Not assigned'],
              ['Specialization', selected.specialization ?? 'Not assigned'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {selected.missingManager && (
            <p className="mt-4 text-sm text-app-danger">
              This person needs a valid reporting manager.
            </p>
          )}
          {selected.departmentId && selected.positionId && (
            <div className="mt-5 flex justify-end">
              <Button
                kind="secondary"
                onClick={() => {
                  const person = selected;
                  setSelected(null);
                  openMove(person);
                }}
              >
                Change reporting manager
              </Button>
            </div>
          )}
        </Modal>
      )}
      {moveSource && (
        <Modal
          title={`Change manager for ${moveSource.fullName}`}
          onClose={() => {
            if (!moveSubmitting) closeMove();
          }}
          dirty={false}
        >
          <p className="text-sm text-app-muted">
            Choose a manager in a higher position. The reporting lines beneath this
            person stay attached.
          </p>
          <div className="org-chart-move-person">
            <span className="org-chart-avatar">{initials(moveSource.fullName)}</span>
            <div>
              <strong>{moveSource.fullName}</strong>
              <p>{moveSource.positionName ?? 'No position assigned'}</p>
            </div>
          </div>
          <Select
            label="New manager"
            value={moveTargetId}
            onChange={(value) => {
              ++previewRequest.current;
              setMoveTargetId(value);
              setMovePreview(null);
              setMovePreviewLoading(false);
              setMoveError(null);
            }}
            options={[
              {
                value: POSITION_DEFAULT,
                label: 'Use position default (clear explicit manager)',
              },
              ...moveCandidates.map((candidate) => ({
                value: candidate.id,
                label:
                  candidate.accountType === 'super-admin'
                    ? `${candidate.fullName} (Super Admin)`
                    : candidate.fullName,
              })),
            ]}
            disabled={moveCandidatesLoading || moveSubmitting}
          />
          {moveCandidatesLoading && (
            <p className="mt-2 text-xs text-app-muted">Loading valid managers…</p>
          )}
          {Boolean(moveError) && (
            <div className="mt-4">
              <ErrorMessage cause={moveError} />
            </div>
          )}
          {movePreview && (
            <div className="org-chart-move-preview" role="status">
              <span className="org-chart-kicker">CHANGE PREVIEW</span>
              <h3>
                {movePreview.affectedUsers[0]?.changed
                  ? 'Reporting line will change'
                  : 'No change needed'}
              </h3>
              <dl>
                <div>
                  <dt>Current manager</dt>
                  <dd>{movePreview.currentManager?.fullName ?? 'No effective manager'}</dd>
                </div>
                <div>
                  <dt>New manager</dt>
                  <dd>{movePreview.proposedManager?.fullName ?? 'Position default'}</dd>
                </div>
              </dl>
              <p>
                Only {moveSource.fullName}&apos;s explicit manager changes. Their reports
                remain linked to them.
              </p>
            </div>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button kind="secondary" onClick={closeMove} disabled={moveSubmitting}>
              Cancel
            </Button>
            {!movePreview ? (
              <Button
                onClick={() => {
                  void previewReportingChange(moveSource, moveTargetId);
                }}
                disabled={!moveTargetId || moveCandidatesLoading || movePreviewLoading || moveSubmitting}
              >
                {movePreviewLoading ? 'Checking…' : 'Preview change'}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  void applyMove();
                }}
                disabled={!movePreview.affectedUsers[0]?.changed || moveSubmitting}
              >
                {moveSubmitting ? 'Saving…' : 'Confirm reporting change'}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </Page>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="org-chart-metric">
      <dt>{label}</dt>
      <dd>{value.toLocaleString()}</dd>
    </div>
  );
}

function reportingDepth(nodes: ReportingNode[]): number {
  return nodes.reduce(
    (depth, node) => Math.max(depth, 1 + reportingDepth(node.children)),
    0,
  );
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toLocaleUpperCase() || '?'
  );
}

function PersonNode({
  node,
  collapsed,
  filtering,
  query,
  departmentId,
  onToggle,
  onSelect,
  onMove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  draggingPersonId,
  dropIds,
}: {
  node: ReportingNode;
  collapsed: Set<string>;
  filtering: boolean;
  query: string;
  departmentId: string;
  onToggle: (id: string) => void;
  onSelect: (person: OrganizationEmployee) => void;
  onMove: (person: OrganizationEmployee) => void;
  onDragStart: (person: OrganizationEmployee, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, targetId: string) => void;
  onDrop: (event: DragEvent<HTMLElement>, targetId: string) => void;
  draggingPersonId: string | null;
  dropIds: ReadonlySet<string>;
}): React.JSX.Element {
  const { person, children } = node;
  const open = filtering || !collapsed.has(person.id);
  const match = filtering && matchesPerson(person, query, departmentId);
  return (
    <li className="org-chart-person-node">
      <div
        className="org-chart-person-shell"
        onDragOver={(event) => onDragOver(event, person.id)}
        onDrop={(event) => onDrop(event, person.id)}
      >
        <div
          className={`org-chart-person${match ? ' org-chart-person-match' : ''}${draggingPersonId === person.id ? ' org-chart-person-dragging' : ''}${draggingPersonId && dropIds.has(person.id) ? ' org-chart-person-drop-target' : ''}`}
          draggable={Boolean(person.departmentId && person.positionId)}
          onDragStart={(event) => onDragStart(person, event)}
          onDragEnd={onDragEnd}
        >
          <button
            type="button"
            className="org-chart-person-main"
            onClick={() => onSelect(person)}
            aria-label={`View ${person.fullName}, ${person.positionName ?? 'no position assigned'}`}
          >
            <span
              className={`org-chart-avatar${children.length ? ' org-chart-avatar-manager' : ''}`}
            >
              {initials(person.fullName)}
            </span>
            <span className="org-chart-person-copy">
              <span className="org-chart-person-name">{person.fullName}</span>
              <span className="org-chart-person-role">
                {person.positionName ?? 'No position assigned'}
              </span>
              {person.teamName && (
                <span className="org-chart-person-team">{person.teamName}</span>
              )}
            </span>
          </button>
          {(person.missingManager || node.cycleBroken) && (
            <span className="org-chart-person-warning">
              {node.cycleBroken
                ? 'Reporting cycle · Review needed'
                : 'Manager needs review'}
            </span>
          )}
        </div>
        {Boolean((person.departmentId && person.positionId) || children.length > 0) && (
          <div className="org-chart-person-actions">
            {person.departmentId && person.positionId && (
              <button
                type="button"
                className="org-chart-person-move"
                onClick={() => onMove(person)}
                aria-label={`Change reporting manager for ${person.fullName}`}
              >
                Change manager
              </button>
            )}
            {children.length > 0 && (
              <button
                type="button"
                className="org-chart-person-toggle"
                aria-expanded={open}
                aria-controls={`reports-${person.id}`}
                aria-label={`${open ? 'Hide' : 'Show'} reports for ${person.fullName}`}
                onClick={() => onToggle(person.id)}
                disabled={filtering}
              >
                {children.length} {children.length === 1 ? 'report' : 'reports'}
                <Icon name={open ? 'chevron-up' : 'chevron-down'} className="size-3" />
              </button>
            )}
          </div>
        )}
      </div>
      {children.length > 0 && open && (
        <ul
          className="org-chart-reports"
          id={`reports-${person.id}`}
          aria-label={`Reports to ${person.fullName}`}
        >
          {children.map((child) => (
            <PersonNode
              key={child.person.id}
              node={child}
              collapsed={collapsed}
              filtering={filtering}
              query={query}
              departmentId={departmentId}
              onToggle={onToggle}
              onSelect={onSelect}
              onMove={onMove}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDrop={onDrop}
              draggingPersonId={draggingPersonId}
              dropIds={dropIds}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
