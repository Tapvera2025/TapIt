import { effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess, type Action } from '@tapcrm/contracts';
import type { RequestContext } from '../../../platform/dal/context.js';
import {
  listChartDepartments,
  listChartRows,
  type ChartDepartmentRow,
  type ChartRow,
} from './repository.js';

export interface OrganizationChartNode extends ChartRow {
  visibleEffectiveManagerIds: string[];
  childrenIds: string[];
  disconnected: boolean;
  isRoot: boolean;
}

export interface OrganizationChartDepartmentNode extends ChartDepartmentRow {
  peopleVisible: boolean;
  structureOnly: boolean;
}

export interface OrganizationChart {
  people: OrganizationChartNode[];
  departments: OrganizationChartDepartmentNode[];
}

/**
 * OR-14: actual reporting graph plus OR-13 department summaries. The route is
 * structure-authorized; employee rows remain constrained by org:view-people.
 */
export async function getOrganizationChart(
  ctx: RequestContext,
  peopleAction: Action = 'org:view-people',
): Promise<OrganizationChart> {
  const [peopleFilter, structurePolicy, peoplePolicy, departments] = await Promise.all([
    visibilityFilter(ctx, peopleAction, 'user'),
    effectivePolicy(ctx, 'org:view-structure'),
    effectivePolicy(ctx, peopleAction),
    listChartDepartments(ctx),
  ]);
  const rows = await listChartRows(ctx, peopleFilter);
  return buildOrganizationChart(
    ctx,
    rows,
    departments,
    structurePolicy?.scope ?? null,
    peoplePolicy?.scope ?? null,
  );
}

/** Pure graph projection; query-time filters have already enforced access. */
export function buildOrganizationChart(
  ctx: RequestContext,
  rows: readonly ChartRow[],
  departments: readonly ChartDepartmentRow[],
  structureScope: string | null,
  peopleScope: string | null,
): OrganizationChart {
  const visible = new Set(rows.map((row) => row.id));
  const children = new Map<string, string[]>();
  for (const row of rows) {
    const parentId = row.reportsTo ?? row.effectiveManagerId;
    if (parentId !== null && visible.has(parentId)) {
      const group = children.get(parentId) ?? [];
      group.push(row.id);
      children.set(parentId, group);
    }
  }
  const people = rows.map((row) => {
    const parentId = row.reportsTo ?? row.effectiveManagerId;
    const visibleEffectiveManagerIds: string[] = [];
    for (const id of row.effectiveManagerIds) {
      if (visible.has(id)) visibleEffectiveManagerIds.push(id);
    }
    const disconnected = parentId !== null && !visible.has(parentId);
    return {
      ...row,
      effectiveManagerId:
        row.effectiveManagerId !== null && visible.has(row.effectiveManagerId)
          ? row.effectiveManagerId
          : null,
      effectiveManagerIds: visibleEffectiveManagerIds,
      visibleEffectiveManagerIds,
      managerVisible: parentId !== null && visible.has(parentId),
      childrenIds: children.get(row.id) ?? [],
      disconnected,
      isRoot: parentId === null || disconnected,
    };
  });

  const ownDepartmentId =
    ctx.principal.accountType === 'employee' ? ctx.principal.departmentId : null;
  const organizationWideStructure =
    globalAccess(ctx.principal) || structureScope === 'department';
  const fullPeopleDepartments = new Set<string>();
  if (globalAccess(ctx.principal) || peopleScope === 'all-people') {
    departments.forEach((department) => fullPeopleDepartments.add(department.id));
  } else if (peopleScope === 'department' && ownDepartmentId !== null) {
    fullPeopleDepartments.add(ownDepartmentId);
  }

  const visibleDepartments: OrganizationChartDepartmentNode[] = [];
  for (const department of departments) {
    if (organizationWideStructure || fullPeopleDepartments.has(department.id)) {
      visibleDepartments.push({
        ...department,
        peopleVisible: fullPeopleDepartments.has(department.id),
        structureOnly: !fullPeopleDepartments.has(department.id),
      });
    }
  }

  return { people, departments: visibleDepartments };
}
