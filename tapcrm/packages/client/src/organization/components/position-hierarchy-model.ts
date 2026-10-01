import type { OrganizationPosition } from '../types/index.js';

export function flattenPositions(
  nodes: readonly OrganizationPosition[],
): OrganizationPosition[] {
  return nodes.flatMap((node) => [node, ...flattenPositions(node.children ?? [])]);
}

export function matchesPosition(
  position: OrganizationPosition,
  query: string,
  status: string,
): boolean {
  const term = query.trim().toLocaleLowerCase();
  return (
    (!status || position.status === status) &&
    (!term || `${position.name} ${position.code}`.toLocaleLowerCase().includes(term))
  );
}

/** Keep ancestors as context, even when they do not match the active filters. */
export function filterPositionTree(
  nodes: readonly OrganizationPosition[],
  query: string,
  status: string,
): OrganizationPosition[] {
  return nodes.flatMap((node) => {
    const children = filterPositionTree(node.children ?? [], query, status);
    return matchesPosition(node, query, status) || children.length > 0
      ? [{ ...node, children }]
      : [];
  });
}

export function positionPath(
  position: OrganizationPosition,
  positions: readonly OrganizationPosition[],
): OrganizationPosition[] {
  const byId = new Map(positions.map((item) => [item.id, item]));
  const path: OrganizationPosition[] = [];
  const visited = new Set<string>();
  let current: OrganizationPosition | undefined = position;
  while (current && !visited.has(current.id)) {
    path.unshift(current);
    visited.add(current.id);
    current = current.parentPositionId ? byId.get(current.parentPositionId) : undefined;
  }
  return path;
}

export function availableParents(
  positions: readonly OrganizationPosition[],
  editing: OrganizationPosition | null,
): OrganizationPosition[] {
  const excluded = new Set(
    editing ? flattenPositions([editing]).map((item) => item.id) : [],
  );
  return positions.filter(
    (position) =>
      !excluded.has(position.id) &&
      (position.status === 'active' || position.id === editing?.parentPositionId),
  );
}

/** The chart may suggest only connections the position hierarchy can accept. */
export function canMoveUnder(
  source: OrganizationPosition,
  target: OrganizationPosition,
  positions: readonly OrganizationPosition[],
): boolean {
  if (
    source.isSeeded ||
    source.id === target.id ||
    source.parentPositionId === target.id ||
    source.departmentId !== target.departmentId ||
    target.status !== 'active' ||
    target.organizationalLevel <= source.organizationalLevel
  ) return false;
  return !positionPath(target, positions).some((ancestor) => ancestor.id === source.id);
}

export function canAddAbove(
  position: OrganizationPosition,
  positions: readonly OrganizationPosition[],
): boolean {
  const parent = positions.find((item) => item.id === position.parentPositionId);
  return Boolean(
    !position.isSeeded && position.status === 'active' && parent &&
    parent.status === 'active' &&
    parent.organizationalLevel - position.organizationalLevel >= 2,
  );
}

export function initialCollapsedPositions(
  nodes: readonly OrganizationPosition[],
  depth = 0,
): string[] {
  return nodes.flatMap((node) => [
    ...(depth >= 2 && node.children?.length ? [node.id] : []),
    ...initialCollapsedPositions(node.children ?? [], depth + 1),
  ]);
}
