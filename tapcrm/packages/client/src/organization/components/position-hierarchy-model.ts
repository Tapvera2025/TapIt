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

/**
 * The level a role of this kind usually gets, read from its title: the same
 * scale the starter company uses (Department Head 90, Project Manager 80,
 * Team Lead 70, Supervisor 50, an executive, developer or agent 20–25, an
 * intern 10). A title with none of these words is an individual contributor.
 */
const ROLE_LEVELS: ReadonlyArray<{ words: readonly string[]; level: number; role: string }> = [
  { words: ['chief', 'ceo', 'cto', 'cfo', 'coo', 'cmo', 'president', 'founder'], level: 95, role: 'company leadership' },
  { words: ['head', 'director', 'hod', 'vp'], level: 90, role: 'department head' },
  { words: ['manager'], level: 75, role: 'manager' },
  { words: ['lead'], level: 70, role: 'team lead' },
  { words: ['supervisor', 'coordinator'], level: 50, role: 'supervisor' },
  { words: ['intern', 'trainee', 'apprentice'], level: 10, role: 'intern or trainee' },
];
const INDIVIDUAL_LEVEL = 25;

function roleOf(name: string): { level: number; role: string } {
  const words = titleWords(name);
  return (
    ROLE_LEVELS.find((entry) => entry.words.some((word) => words.includes(word))) ?? {
      level: INDIVIDUAL_LEVEL,
      role: 'team member',
    }
  );
}

/**
 * Which of two titles is the more senior: 1 when `name` is, -1 when
 * `otherName` is, 0 when the titles do not say. Titles that differ only by a
 * word like "Senior" or "Junior" decide first; otherwise the kind of role does
 * ("Sales Head" outranks "Sales Agent").
 */
export function compareTitleSeniority(name: string, otherName: string): -1 | 0 | 1 {
  if (titleSoundsMoreSenior(name, otherName)) return 1;
  if (titleSoundsMoreSenior(otherName, name)) return -1;
  const own = roleOf(name).level;
  const other = roleOf(otherName).level;
  return own === other ? 0 : own > other ? 1 : -1;
}

export type LevelSuggestion = {
  level: number;
  /** Why this level, in a few plain words, e.g. "one step above Graphic Designer (level 60)". */
  reason: string;
};

function clampLevel(level: number): number {
  return Math.min(HIGHEST_POSITION_LEVEL, Math.max(LOWEST_POSITION_LEVEL, Math.round(level)));
}

/**
 * A level for a new position, from its title and the positions already in the
 * department, so whoever creates it does not have to remember what the others
 * were given.
 *
 * A title that is another one's senior or junior version ("Senior Graphic
 * Designer" and "Graphic Designer") goes one step above or below it, without
 * passing the next position. Otherwise the usual level for that kind of role
 * is used, moved if needed so that it stays below every more senior kind of
 * role in the department and above every more junior one. Null when there is
 * no title yet or no room is left.
 */
export function suggestLevel(
  positions: readonly OrganizationPosition[],
  name: string,
  excludeId?: string,
): LevelSuggestion | null {
  if (titleWords(name).length === 0) return null;
  const ranked = positionsBySeniority(positions, excludeId);

  const sameRole = ranked.find(
    (position) =>
      titleSoundsMoreSenior(name, position.name) || titleSoundsMoreSenior(position.name, name),
  );
  if (sameRole) {
    const base = sameRole.organizationalLevel;
    if (titleSoundsMoreSenior(name, sameRole.name)) {
      const above = ranked.filter((position) => position.organizationalLevel > base).at(-1);
      const ceiling = above ? above.organizationalLevel : HIGHEST_POSITION_LEVEL + 1;
      if (ceiling - base < 2) return null;
      return {
        level: clampLevel(Math.min(base + 10, Math.floor((base + ceiling) / 2))),
        reason: `one step above ${sameRole.name} (level ${base})`,
      };
    }
    const below = ranked.find((position) => position.organizationalLevel < base);
    const floor = below ? below.organizationalLevel : LOWEST_POSITION_LEVEL - 1;
    if (base - floor < 2) return null;
    return {
      level: clampLevel(Math.max(base - 10, Math.ceil((base + floor) / 2))),
      reason: `one step below ${sameRole.name} (level ${base})`,
    };
  }

  const { level: usual, role } = roleOf(name);
  const words = titleWords(name);
  const adjusted =
    usual +
    (words.some((word) => word === 'senior' || word === 'sr') ? 10 : 0) -
    (words.some((word) => word === 'junior' || word === 'jr' || word === 'assistant') ? 5 : 0);
  // Stay below every more senior kind of role and above every more junior one.
  const seniorTo = ranked.filter((position) => compareTitleSeniority(name, position.name) < 0);
  const juniorTo = ranked.filter((position) => compareTitleSeniority(name, position.name) > 0);
  const ceiling = Math.min(HIGHEST_POSITION_LEVEL + 1, ...seniorTo.map((p) => p.organizationalLevel));
  const floor = Math.max(LOWEST_POSITION_LEVEL - 1, ...juniorTo.map((p) => p.organizationalLevel));
  if (adjusted > floor && adjusted < ceiling)
    return { level: clampLevel(adjusted), reason: `the usual level for a ${role}` };
  if (ceiling - floor < 2) return null;
  const between = clampLevel(Math.floor((floor + ceiling) / 2));
  const lowerName = juniorTo.find((p) => p.organizationalLevel === floor)?.name;
  const upperName = seniorTo.find((p) => p.organizationalLevel === ceiling)?.name;
  return {
    level: between,
    reason:
      lowerName && upperName
        ? `between ${lowerName} (level ${floor}) and ${upperName} (level ${ceiling})`
        : upperName
          ? `below ${upperName} (level ${ceiling})`
          : `above ${lowerName ?? 'the others'} (level ${floor})`,
  };
}

export type LevelTitleMismatch = {
  position: OrganizationPosition;
  /** True: the title entered sounds more senior; false: the other one does. */
  enteredSoundsSenior: boolean;
};

/**
 * Positions whose titles and levels disagree with the one being entered, such
 * as "Senior Graphic Designer" at level 60 while "Graphic Designer" sits at 70,
 * or a "Sales Agent" at 60 while the "Sales Head" sits at 50. The level
 * decides who reports to whom, so a slip like this puts the senior role under
 * the junior one. `enteredSoundsSenior` says which way round it is.
 */
export function levelTitleMismatches(
  positions: readonly OrganizationPosition[],
  name: string,
  level: number,
  excludeId?: string,
): LevelTitleMismatch[] {
  return positionsBySeniority(positions, excludeId).flatMap<LevelTitleMismatch>(
    (position) => {
      const seniority = compareTitleSeniority(name, position.name);
      if (seniority > 0 && level <= position.organizationalLevel)
        return [{ position, enteredSoundsSenior: true }];
      if (seniority < 0 && level >= position.organizationalLevel)
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
