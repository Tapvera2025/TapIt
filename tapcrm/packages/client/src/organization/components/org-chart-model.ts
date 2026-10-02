import type { OrganizationEmployee } from '../types/index.js';

export interface ReportingNode {
  person: OrganizationEmployee;
  children: ReportingNode[];
  cycleBroken: boolean;
}

/** Keep every visible person, including disconnected records and malformed cycles. */
export function buildReportingForest(
  people: readonly OrganizationEmployee[],
): ReportingNode[] {
  const nodes = new Map<string, ReportingNode>(
    people.map((person) => [person.id, { person, children: [], cycleBroken: false }]),
  );
  const parents = new Map<string, string>();
  const roots: ReportingNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.person.reportsTo ?? node.person.effectiveManagerId;
    if (!parentId || !nodes.has(parentId)) continue;
    const visited = new Set([node.person.id]);
    let ancestor: string | undefined = parentId;
    while (ancestor && !visited.has(ancestor)) {
      visited.add(ancestor);
      ancestor = parents.get(ancestor);
    }
    if (ancestor) node.cycleBroken = true;
    else parents.set(node.person.id, parentId);
  }
  for (const node of nodes.values()) {
    const parent = nodes.get(parents.get(node.person.id) ?? '');
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: ReportingNode[]): void => {
    list.sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));
    list.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

export function matchesPerson(
  person: OrganizationEmployee,
  query: string,
  departmentId: string,
): boolean {
  return (
    (!departmentId || person.departmentId === departmentId) &&
    (!query.trim() ||
      [
        person.fullName,
        person.positionName,
        person.departmentName,
        person.teamName,
        person.designationName,
        person.specialization,
      ].some((value) =>
        value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ))
  );
}

/** Preserve the path to each match so a search never loses reporting context. */
export function filterReportingForest(
  nodes: readonly ReportingNode[],
  query: string,
  departmentId: string,
): ReportingNode[] {
  if (!query.trim() && !departmentId) return [...nodes];
  return nodes.flatMap((node) => {
    const children = filterReportingForest(node.children, query, departmentId);
    return matchesPerson(node.person, query, departmentId) || children.length
      ? [{ ...node, children }]
      : [];
  });
}
