import { describe, expect, it } from 'vitest';
import type { OrganizationPosition } from '../types/index.js';
import {
  availableParents,
  canAddAbove,
  canMoveUnder,
  filterPositionTree,
  flattenPositions,
  initialCollapsedPositions,
  levelTitleMismatches,
  positionPath,
  positionsBelowNewLevel,
  positionsBySeniority,
  suggestLevel,
  suggestParentForLevel,
  titleSoundsMoreSenior,
} from './position-hierarchy-model.js';

function position(
  id: string,
  parentPositionId: string | null,
  children: OrganizationPosition[] = [],
  status = 'active',
): OrganizationPosition {
  return {
    id,
    name: id,
    code: `DEV-${id.toUpperCase()}`,
    organizationId: 'org',
    departmentId: 'dev',
    parentPositionId,
    children,
    organizationalLevel: 50,
    status,
    holderCount: 0,
    isSeeded: false,
    maxDealValue: null,
    maxDiscountPercent: null,
    allowsCustomTerms: false,
  };
}
const developer = position('Developer', 'Lead');
const intern = position('Intern', 'Developer');
developer.children = [intern];
const lead = position('Lead', 'Head', [developer]);
const analyst = position('Analyst', 'Head', [], 'inactive');
const head = position('Head', null, [lead, analyst]);
const forest = [head];

describe('position hierarchy explorer', () => {
  it('keeps the full parent path to a name or code match', () => {
    const filtered = filterPositionTree(forest, 'dev-developer', '');
    expect(flattenPositions(filtered).map((node) => node.id)).toEqual([
      'Head',
      'Lead',
      'Developer',
    ]);
    expect(developer.children).toEqual([intern]);
  });
  it('keeps active parent context when finding inactive positions', () => {
    expect(
      flattenPositions(filterPositionTree(forest, '', 'inactive')).map((node) => node.id),
    ).toEqual(['Head', 'Analyst']);
  });
  it('builds an ordered ancestry path without looping on malformed data', () => {
    expect(positionPath(intern, flattenPositions(forest)).map((node) => node.id)).toEqual(
      ['Head', 'Lead', 'Developer', 'Intern'],
    );
    const a = position('A', 'B');
    const b = position('B', 'A');
    expect(positionPath(a, [a, b]).map((node) => node.id)).toEqual(['B', 'A']);
  });
  it('excludes self, descendants, and inactive positions from a new parent choice', () => {
    expect(
      availableParents(flattenPositions(forest), lead).map((node) => node.id),
    ).toEqual(['Head']);
    expect(
      availableParents(flattenPositions(forest), null).map((node) => node.id),
    ).not.toContain('Analyst');
  });
  it('starts with three levels visible and keeps empty or unmatched trees empty', () => {
    expect(initialCollapsedPositions(forest)).toEqual(['Developer']);
    expect(filterPositionTree(forest, 'not found', '')).toEqual([]);
    expect(flattenPositions([])).toEqual([]);
  });
  it('permits only valid position connections and leaves seeded positions fixed', () => {
    head.organizationalLevel = 100;
    lead.organizationalLevel = 70;
    developer.organizationalLevel = 50;
    intern.organizationalLevel = 20;
    const sibling = position('Sibling', 'Head');
    sibling.organizationalLevel = 80;
    head.children?.push(sibling);
    const positions = flattenPositions(forest);
    expect(canMoveUnder(developer, sibling, positions)).toBe(true);
    expect(canMoveUnder(developer, intern, positions)).toBe(false);
    expect(canMoveUnder(developer, lead, positions)).toBe(false);
    expect(canMoveUnder(head, developer, positions)).toBe(false);
    sibling.status = 'inactive';
    expect(canMoveUnder(developer, sibling, positions)).toBe(false);
    sibling.status = 'active';
    developer.isSeeded = true;
    expect(canMoveUnder(developer, sibling, positions)).toBe(false);
    developer.isSeeded = false;
  });
  it('inserts above only when there is an available level between parent and child', () => {
    head.organizationalLevel = 100;
    lead.organizationalLevel = 60;
    expect(canAddAbove(lead, flattenPositions(forest))).toBe(true);
    lead.organizationalLevel = 99;
    expect(canAddAbove(lead, flattenPositions(forest))).toBe(false);
    lead.organizationalLevel = 50;
    expect(canAddAbove(head, flattenPositions(forest))).toBe(false);
  });
  it("lets a new top go above the department's top while a higher level is left", () => {
    head.organizationalLevel = 90;
    expect(canAddAbove(head, flattenPositions(forest))).toBe(true);
    head.isSeeded = true;
    expect(canAddAbove(head, flattenPositions(forest))).toBe(false);
    head.isSeeded = false;
    head.organizationalLevel = 100;
  });
});

describe('placing a position by its level', () => {
  function at(
    id: string,
    level: number,
    parentPositionId: string | null,
    extra: Partial<OrganizationPosition> = {},
  ): OrganizationPosition {
    return { ...position(id, parentPositionId), organizationalLevel: level, ...extra };
  }
  const graphicDesigner = at('Graphic Designer', 70, null);
  const designIntern = at('Design Intern', 20, 'Graphic Designer');
  const archived = at('Old Lead', 65, 'Graphic Designer', { status: 'inactive' });
  const graphics = [graphicDesigner, designIntern, archived];

  it('suggests the closest active position above the level as the one it reports to', () => {
    expect(suggestParentForLevel(graphics, 60)?.id).toBe('Graphic Designer');
    expect(suggestParentForLevel(graphics, 10)?.id).toBe('Design Intern');
  });
  it('suggests no parent when nothing ranks above, so it becomes the top', () => {
    expect(suggestParentForLevel(graphics, 80)).toBeNull();
    expect(suggestParentForLevel(graphics, 70)).toBeNull();
    expect(suggestParentForLevel([], 60)).toBeNull();
  });
  it('lists the tops a new top takes under it, keeping built-in ones apart', () => {
    const builtIn = at('Built-in', 50, null, { isSeeded: true });
    const below = positionsBelowNewLevel([...graphics, builtIn], null, 80);
    expect(below.movable.map(({ id }) => id)).toEqual(['Graphic Designer']);
    expect(below.fixed.map(({ id }) => id)).toEqual(['Built-in']);
    expect(positionsBelowNewLevel(graphics, null, 70).movable).toEqual([]);
  });
  it('orders active positions from most to least senior', () => {
    expect(positionsBySeniority(graphics).map(({ id }) => id)).toEqual([
      'Graphic Designer',
      'Design Intern',
    ]);
    expect(
      positionsBySeniority(graphics, 'Graphic Designer').map(({ id }) => id),
    ).toEqual(['Design Intern']);
  });
  it('reads seniority from titles that only differ by a senior or junior word', () => {
    expect(titleSoundsMoreSenior('Senior Graphic Designer', 'Graphic Designer')).toBe(
      true,
    );
    expect(titleSoundsMoreSenior('Sr. Graphic Designer', 'graphic designer')).toBe(true);
    expect(titleSoundsMoreSenior('Graphic Designer', 'Junior Graphic Designer')).toBe(
      true,
    );
    expect(titleSoundsMoreSenior('Graphic Designer', 'Senior Graphic Designer')).toBe(
      false,
    );
    expect(titleSoundsMoreSenior('Motion Graphic Designer', 'Graphic Designer')).toBe(
      false,
    );
    expect(titleSoundsMoreSenior('Video Editor', 'Graphic Designer')).toBe(false);
  });
  it('flags a senior title entered below the role it outranks', () => {
    expect(
      levelTitleMismatches(graphics, 'Senior Graphic Designer', 60).map((item) => [
        item.position.id,
        item.enteredSoundsSenior,
      ]),
    ).toEqual([['Graphic Designer', true]]);
    expect(levelTitleMismatches(graphics, 'Senior Graphic Designer', 80)).toEqual([]);
    expect(
      levelTitleMismatches(
        [at('Senior Graphic Designer', 60, null)],
        'Graphic Designer',
        70,
      ).map((item) => item.enteredSoundsSenior),
    ).toEqual([false]);
  });
});

describe('suggesting a level for a new position', () => {
  function at(id: string, level: number, parentPositionId: string | null = null): OrganizationPosition {
    return { ...position(id, parentPositionId), organizationalLevel: level };
  }

  it('puts a senior version of a role one step above it, under the next position up', () => {
    expect(suggestLevel([at('Graphic Designer', 60)], 'Senior Graphic Designer')).toEqual({
      level: 70,
      reason: 'one step above Graphic Designer (level 60)',
    });
    expect(
      suggestLevel([at('Graphic Designer', 60), at('Design Head', 66)], 'Senior Graphic Designer')?.level,
    ).toBe(63);
  });

  it('puts a junior version of a role one step below it', () => {
    expect(suggestLevel([at('Graphic Designer', 60)], 'Junior Graphic Designer')).toEqual({
      level: 50,
      reason: 'one step below Graphic Designer (level 60)',
    });
  });

  it('uses the usual level for the kind of role when nothing similar exists', () => {
    expect(suggestLevel([], 'Sales Head')?.level).toBe(90);
    expect(suggestLevel([], 'Sales Agent')?.level).toBe(25);
    expect(suggestLevel([], 'Design Intern')?.level).toBe(10);
  });

  it('keeps a junior kind of role below a more senior one already in the department', () => {
    // A Sales Head was given 50; an agent must still land below it.
    expect(suggestLevel([at('Sales Head', 50)], 'Sales Agent')?.level).toBe(25);
    expect(suggestLevel([at('Sales Head', 20)], 'Sales Agent')).toEqual({
      level: 10,
      reason: 'below Sales Head (level 20)',
    });
    expect(suggestLevel([at('Sales Agent', 60)], 'Sales Head')?.level).toBe(90);
  });

  it('suggests nothing without a title or without room', () => {
    expect(suggestLevel([at('Graphic Designer', 60)], '  ')).toBeNull();
    expect(
      suggestLevel([at('Graphic Designer', 60), at('Art Director', 61)], 'Senior Graphic Designer'),
    ).toBeNull();
  });

  it('flags an agent placed above the head of the department', () => {
    expect(
      levelTitleMismatches([at('Sales Head', 50)], 'Sales Agent', 60).map((item) => [
        item.position.id,
        item.enteredSoundsSenior,
      ]),
    ).toEqual([['Sales Head', false]]);
    expect(levelTitleMismatches([at('Sales Head', 50)], 'Sales Agent', 40)).toEqual([]);
  });
});
