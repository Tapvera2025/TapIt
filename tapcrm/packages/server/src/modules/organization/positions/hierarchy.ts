import { OrganizationValidationError, ORGANIZATION_ERROR_CODES } from '../errors.js';
import type { PositionRecord } from './repository.js';

export interface PositionNode extends PositionRecord {
  holderCount: number;
  children: PositionNode[];
}

export function buildPositionTree(
  rows: Array<PositionRecord & { holderCount: number }>,
): PositionNode[] {
  const nodes = new Map(
    rows.map((row) => [row.id, { ...row, children: [] as PositionNode[] }]),
  );
  const roots: PositionNode[] = [];
  for (const node of nodes.values()) {
    const parent =
      node.parentPositionId === null ? undefined : nodes.get(node.parentPositionId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  const sort = (items: PositionNode[]) => {
    items.sort(
      (a, b) =>
        b.organizationalLevel - a.organizationalLevel || a.name.localeCompare(b.name),
    );
    items.forEach((item) => sort(item.children));
  };
  sort(roots);
  return roots;
}

export function assertPositionLevel(input: {
  position: string;
  level: number;
  parent: PositionRecord | null;
  children: PositionRecord[];
}): void {
  if (input.parent !== null && input.level >= input.parent.organizationalLevel) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_LEVEL_CONFLICT,
      `Position ${input.position} must have a lower organizational level than parent ${input.parent.name}`,
      {
        positionId: input.position,
        parentId: input.parent.id,
        currentLevel: input.level,
        requiredLevelRange: '< parent level',
      },
    );
  }
  const child = input.children.find((item) => input.level <= item.organizationalLevel);
  if (child !== undefined) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_LEVEL_CONFLICT,
      `Position ${input.position} must have a higher organizational level than child ${child.name}`,
      {
        positionId: input.position,
        childId: child.id,
        currentLevel: input.level,
        childLevel: child.organizationalLevel,
        requiredLevelRange: '> child level',
      },
    );
  }
}

export function assertPositionApprovalLimits(input: {
  positionId: string;
  maxDealValue: number | null;
  maxDiscountPercent: number | null;
  allowsCustomTerms: boolean;
  children: readonly Pick<
    PositionRecord,
    'id' | 'name' | 'maxDealValue' | 'maxDiscountPercent' | 'allowsCustomTerms'
  >[];
}): void {
  for (const child of input.children) {
    if (
      input.maxDealValue !== null &&
      child.maxDealValue !== null &&
      Number(child.maxDealValue) > input.maxDealValue
    ) {
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.POSITION_LIMIT_EXCEEDED,
        `Parent position limit cannot fall below child position ${child.name}'s maxDealValue`,
        {
          field: 'maxDealValue',
          childId: child.id,
          childLimit: child.maxDealValue,
          requested: input.maxDealValue,
        },
      );
    }
    if (
      input.maxDiscountPercent !== null &&
      child.maxDiscountPercent !== null &&
      Number(child.maxDiscountPercent) > input.maxDiscountPercent
    ) {
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.POSITION_LIMIT_EXCEEDED,
        `Parent position limit cannot fall below child position ${child.name}'s maxDiscountPercent`,
        {
          field: 'maxDiscountPercent',
          childId: child.id,
          childLimit: child.maxDiscountPercent,
          requested: input.maxDiscountPercent,
        },
      );
    }
    if (child.allowsCustomTerms && !input.allowsCustomTerms) {
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.POSITION_LIMIT_EXCEEDED,
        `Parent position ${input.positionId} cannot disable custom terms used by child position ${child.name}`,
        {
          field: 'allowsCustomTerms',
          childId: child.id,
          requested: input.allowsCustomTerms,
        },
      );
    }
  }
}
