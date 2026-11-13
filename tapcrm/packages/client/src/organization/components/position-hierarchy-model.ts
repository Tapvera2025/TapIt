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
  if (position.isSeeded || position.status !== 'active') return false;
  // The department's top can get a new top above it while a higher level is left.
  if (position.parentPositionId === null)
    return position.organizationalLevel < HIGHEST_POSITION_LEVEL;
  const parent = positions.find((item) => item.id === position.parentPositionId);
  return Boolean(
    parent &&
    parent.status === 'active' &&
    parent.organizationalLevel - position.organizationalLevel >= 2,
  );
}

/** Levels run from 1 (most junior) to 100 (most senior). */
export const LOWEST_POSITION_LEVEL = 1;
export const HIGHEST_POSITION_LEVEL = 100;

/**
 * Who a position at this level most likely reports to: the active position
 * with the closest higher level. `null` when nothing in the department
 * outranks it, so it reports to the Super Admin as the department's top.
 */
export function suggestParentForLevel(
  positions: readonly OrganizationPosition[],
  level: number,
): OrganizationPosition | null {
  let closest: OrganizationPosition | null = null;
  for (const candidate of positions) {
    if (candidate.status !== 'active' || candidate.organizationalLevel <= level) continue;
    if (!closest || candidate.organizationalLevel < closest.organizationalLevel)
      closest = candidate;
  }
  return closest;
}

/**
 * The positions that would move under a new one placed beneath `parentId`
 * (`null`: as the department's top): active direct reports of that parent
 * that rank below the new level. Built-in positions cannot move, so they are
 * returned apart.
 */
export function positionsBelowNewLevel(
  positions: readonly OrganizationPosition[],
  parentId: string | null,
  level: number,
): { movable: OrganizationPosition[]; fixed: OrganizationPosition[] } {
  const below = positions.filter(
    (position) =>
      position.parentPositionId === parentId &&
      position.status === 'active' &&
      position.organizationalLevel < level,
  );
  return {
    movable: below.filter((position) => !position.isSeeded),
    fixed: below.filter((position) => position.isSeeded),
  };
}

/** Active positions from most to least senior; the order the level guide shows. */
export function positionsBySeniority(
  positions: readonly OrganizationPosition[],
  excludeId?: string,
): OrganizationPosition[] {
  return positions
    .filter((position) => position.status === 'active' && position.id !== excludeId)
    .sort(
      (a, b) =>
        b.organizationalLevel - a.organizationalLevel || a.name.localeCompare(b.name),
    );
}

const SENIOR_TITLE_WORDS = new Set([
  'senior',
  'sr',
  'lead',
  'head',
  'chief',
  'principal',
  'manager',
  'director',
  'supervisor',
]);
const JUNIOR_TITLE_WORDS = new Set([
  'junior',
  'jr',
  'intern',
  'trainee',
  'assistant',
  'apprentice',
]);

function titleWords(name: string): string[] {
  return name
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Whether `part` appears, word for word, inside the longer `whole`. */
function containsTitle(whole: readonly string[], part: readonly string[]): boolean {
  if (part.length === 0 || part.length >= whole.length) return false;
  for (let start = 0; start + part.length <= whole.length; start += 1)
    if (part.every((word, index) => whole[start + index] === word)) return true;
  return false;
}

/** "Senior Graphic Designer" over "Graphic Designer", or "Designer" over "Junior Designer". */
export function titleSoundsMoreSenior(name: string, otherName: string): boolean {
  const words = titleWords(name);
  const otherWords = titleWords(otherName);
  if (containsTitle(words, otherWords))
    return words.some(
      (word) => !otherWords.includes(word) && SENIOR_TITLE_WORDS.has(word),
    );
  if (containsTitle(otherWords, words))
    return otherWords.some(
      (word) => !words.includes(word) && JUNIOR_TITLE_WORDS.has(word),
    );
  return false;
}

export type LevelTitleMismatch = {
  position: OrganizationPosition;
  /** True: the title entered sounds more senior; false: the other one does. */
  enteredSoundsSenior: boolean;
};

/**
 * Positions whose titles and levels disagree with the one being entered, such
 * as "Senior Graphic Designer" at level 60 while "Graphic Designer" sits at 70.
 * The level decides who reports to whom, so a slip like this puts the senior
 * role under the junior one. `enteredSoundsSenior` says which way round it is.
 */
export function levelTitleMismatches(
  positions: readonly OrganizationPosition[],
  name: string,
  level: number,
  excludeId?: string,
): LevelTitleMismatch[] {
  return positionsBySeniority(positions, excludeId).flatMap<LevelTitleMismatch>(
    (position) => {
      if (
        level <= position.organizationalLevel &&
        titleSoundsMoreSenior(name, position.name)
      )
        return [{ position, enteredSoundsSenior: true }];
      if (
        level >= position.organizationalLevel &&
        titleSoundsMoreSenior(position.name, name)
      )
        return [{ position, enteredSoundsSenior: false }];
      return [];
    },
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
