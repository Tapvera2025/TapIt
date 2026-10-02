import { describe, expect, it } from 'vitest';
import type { DateOnly } from '@tapcrm/contracts';
import { isEmployedOn, opensDaysOn, type EmploymentSubject } from './employment.js';

const d = (v: string) => v as DateOnly;
const employee = (
  status: string,
  window: { joinedOn?: string; leftOn?: string } = {},
): EmploymentSubject => ({
  id: 'u1',
  accountType: 'employee',
  status,
  joinedOn: window.joinedOn === undefined ? null : d(window.joinedOn),
  leftOn: window.leftOn === undefined ? null : d(window.leftOn),
});

describe('employment window (§8.6)', () => {
  it('without dates, an employee is employed on every date, and their days open', () => {
    expect(isEmployedOn(employee('active'), d('2026-01-01'))).toBe(true);
    expect(isEmployedOn(employee('active'), d('2100-12-31'))).toBe(true);
    expect(opensDaysOn(employee('active'), d('2026-01-01'))).toBe(true);
  });

  it('a login lock does not end employment', () => {
    expect(opensDaysOn(employee('locked'), d('2026-01-01'))).toBe(true);
  });

  it('a deactivated account without a leaving date gets no new days, and keeps its history', () => {
    expect(opensDaysOn(employee('inactive'), d('2026-01-01'))).toBe(false);
    expect(opensDaysOn(employee('offboarded'), d('2026-01-01'))).toBe(false);
    // Its past days are still judged by the window, not by today's status.
    expect(isEmployedOn(employee('offboarded'), d('2026-01-01'))).toBe(true);
  });

  it('nobody is employed before the joining date; the joining date itself counts', () => {
    const joiner = employee('active', { joinedOn: '2026-10-05' });
    expect(isEmployedOn(joiner, d('2026-10-04'))).toBe(false);
    expect(isEmployedOn(joiner, d('2026-10-05'))).toBe(true);
  });

  it('the leaving date is the last working day, whatever the account status', () => {
    const leaver = employee('offboarded', {
      joinedOn: '2026-01-01',
      leftOn: '2026-10-10',
    });
    expect(isEmployedOn(leaver, d('2026-10-10'))).toBe(true);
    expect(opensDaysOn(leaver, d('2026-10-10'))).toBe(true);
    expect(isEmployedOn(leaver, d('2026-10-11'))).toBe(false);
    expect(
      opensDaysOn(employee('active', { leftOn: '2026-10-10' }), d('2026-10-11')),
    ).toBe(false);
  });

  it('only employees have attendance days', () => {
    for (const accountType of ['super-admin', 'client', 'service']) {
      expect(isEmployedOn({ ...employee('active'), accountType }, d('2026-01-01'))).toBe(
        false,
      );
    }
  });
});
