import { describe, expect, it } from 'vitest';
import { ORGANIZATION_TEMPLATE, templateForModules } from './template.js';

describe('organization starter template', () => {
  it('selects only HR structure for the Employee Directory module', () => {
    const template = templateForModules(['employee-directory']);

    expect(template.departments.map((department) => department.code)).toEqual(['hr']);
    expect(
      template.positions.every((position) =>
        ['hr', 'finance'].includes(position.department),
      ),
    ).toBe(true);
    expect(template.positions.some((position) => position.department === 'sales')).toBe(
      false,
    );
    expect(template.designations).toHaveLength(0);
  });

  it('selects Development structure and designations for delivery modules', () => {
    const template = templateForModules(['projects']);

    expect(template.departments.map((department) => department.code)).toEqual([
      'projects',
      'development',
    ]);
    expect(template.positions.some((position) => position.code === 'dev-dept-head')).toBe(
      true,
    );
    expect(template.designations.map((designation) => designation.name)).toEqual([
      'Developer',
      'Marketing Executive',
      'Content Writer',
    ]);
    expect(template.designations.every((designation) => designation.department === 'development')).toBe(true);
    expect(template.teams.map((team) => team.name)).toEqual([
      'Developer Team',
      'Digital & Marketing',
      'Content Team',
    ]);
  });

  it('retains the complete seeded structure for the seed command', () => {
    const template = templateForModules([], true);

    expect(template.departments).toHaveLength(ORGANIZATION_TEMPLATE.departments.length);
    expect(template.positions).toHaveLength(ORGANIZATION_TEMPLATE.positions.length);
    expect(template.teams).toHaveLength(ORGANIZATION_TEMPLATE.teams.length);
    expect(template.designations).toHaveLength(ORGANIZATION_TEMPLATE.designations.length);
  });

  it('defines only the four requested intern positions with base-employee access', () => {
    const interns = ORGANIZATION_TEMPLATE.positions.filter((position) =>
      position.code.endsWith('-intern'),
    );

    expect(interns).toEqual([
      expect.objectContaining({
        code: 'developer-intern',
        name: 'Developer Intern',
        department: 'development',
        level: 10,
        parent: 'developer-team-manager',
        matrixColumn: 'base-employee',
      }),
      expect.objectContaining({
        code: 'content-intern',
        name: 'Content Intern',
        department: 'development',
        level: 10,
        parent: 'content-team-manager',
        matrixColumn: 'base-employee',
      }),
      expect.objectContaining({
        code: 'marketing-executive-intern',
        name: 'Marketing Executive Intern',
        department: 'development',
        level: 10,
        parent: 'digital-marketing-manager',
        matrixColumn: 'base-employee',
      }),
      expect.objectContaining({
        code: 'hr-intern',
        name: 'HR Intern',
        department: 'hr',
        level: 10,
        parent: 'hr',
        matrixColumn: 'base-employee',
      }),
    ]);
    expect(interns.some((position) => position.department === 'sales')).toBe(false);
    expect(interns.some((position) => position.code === 'project-intern')).toBe(false);
    expect(interns.some((position) => position.department === 'finance')).toBe(false);
  });
});
