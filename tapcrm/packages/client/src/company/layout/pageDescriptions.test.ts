import { describe, expect, it } from 'vitest';
import { descriptionForTitle } from './CompanyPageHero.js';

describe('descriptionForTitle', () => {
  it('tells apart the "Overview" of different modules', () => {
    expect(descriptionForTitle('Overview', 'Sales')).toMatch(/sales/i);
    expect(descriptionForTitle('Overview', 'Organization')).toMatch(/departments/i);
    expect(descriptionForTitle('Overview', 'Recruitment')).toMatch(/hiring/i);
  });

  it('has a real description for the pages that used to get the generic filler', () => {
    for (const title of [
      'Today', 'Settings', 'Leave Queue', 'Payroll Runs', 'Sessions & Devices',
      'Access Explorer', 'Audit Log', 'Geofencing', 'Departments', 'Teams',
    ]) {
      expect(descriptionForTitle(title)).not.toMatch(/across your company workspace/);
    }
  });

  it('still falls back to a sensible line for an unknown title', () => {
    expect(descriptionForTitle('Something new')).toBe('Work with something new across your company workspace.');
  });
});
