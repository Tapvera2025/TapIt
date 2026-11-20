import { describe, expect, it } from 'vitest';
import { companySearchDestinations, type ScreenAccessSubject } from './navigation.js';
import { searchCompanyDestinations } from './GlobalFeatureSearch.js';

/** An employee whose position holds these powers at department reach. */
const holding = (
  actions: readonly string[],
  extra: Partial<ScreenAccessSubject> = {},
): ScreenAccessSubject => ({
  accountType: 'employee',
  capabilities: actions.map((action) => ({ action, scope: 'department' })),
  ...extra,
});

describe('company feature search', () => {
  it('derives accessible destinations from navigation and action capabilities', () => {
    const destinations = companySearchDestinations(holding([]));

    expect(destinations.some((item) => item.label === 'Dashboard')).toBe(true);
    expect(destinations.some((item) => item.label === 'Clients')).toBe(false);
    expect(destinations.some((item) => item.label === 'Settings')).toBe(true);
  });

  it('includes action-gated destinations only when the capability is present', () => {
    const destinations = companySearchDestinations(holding(['clients:view', 'projects:view']));

    expect(destinations.some((item) => item.label === 'Clients')).toBe(true);
    expect(destinations.some((item) => item.label === 'Projects')).toBe(true);
    expect(destinations.some((item) => item.label === 'Employees')).toBe(false);
  });

  it('supports exact, partial, case-insensitive and category matching', () => {
    const destinations = companySearchDestinations(holding(['tasks:view']));

    expect(searchCompanyDestinations(destinations, 'dashboard')[0]?.label).toBe(
      'Dashboard',
    );
    expect(searchCompanyDestinations(destinations, 'Task')[0]?.label).toBe('Tasks');
    expect(searchCompanyDestinations(destinations, 'TODO')[0]?.label).toBe('My Todo');
    expect(searchCompanyDestinations(destinations, 'overview').length).toBeGreaterThan(0);
    expect(searchCompanyDestinations(destinations, 'does-not-exist')).toHaveLength(0);
  });

  it('matches short keywords and multi-word searches across accessible destinations', () => {
    const destinations = companySearchDestinations(
      holding(['attendance:view-live', 'payroll:manage', 'payroll:manage-config']),
    );

    const wResults = searchCompanyDestinations(destinations, 'W');
    expect(wResults.some((item) => item.label === 'Workforce Board')).toBe(true);
    expect(wResults.some((item) => item.label === 'Dashboard')).toBe(false);
    expect(wResults.some((item) => item.label === 'Holidays')).toBe(false);
    expect(wResults.some((item) => item.label === 'My Attendance')).toBe(false);
    expect(searchCompanyDestinations(destinations, 'payroll settings')[0]?.label).toBe('Payroll Settings');
  });

  it('supports calendar and audit aliases without bypassing permissions', () => {
    const destinations = companySearchDestinations(holding(['audit:view', 'holidays:view']));

    expect(searchCompanyDestinations(destinations, 'weekends')[0]?.label).toBe('Holidays');
    expect(searchCompanyDestinations(destinations, 'audit trail')[0]?.label).toBe('Audit Log');
    expect(companySearchDestinations(holding([])).some((item) => item.label === 'Audit Log')).toBe(false);
  });

  it('indexes every conditional sidebar destination with its matching capability', () => {
    const destinations = companySearchDestinations(
      holding(
        [
          'deals:view',
          'deals:record-win',
          'deals:forecast',
          'approvals:decide',
          'shifts:manage',
          'shifts:view',
          'payroll:manage',
          'payroll:view',
          'accounting:view-ledger',
          'access:request-role-change',
          'recruitment:submit-round-feedback',
        ],
        { hasInterviews: true },
      ),
    );

    for (const label of ['My Interviews', 'Pipeline', 'Approvals', 'Wins to record', 'Reports', 'Weekday Schedules', 'Payroll Cycle', 'Accounting', 'Request Role Change']) {
      expect(destinations.some((item) => item.label === label)).toBe(true);
    }
    expect(searchCompanyDestinations(destinations, 'win record')[0]?.label).toBe('Wins to record');
    expect(searchCompanyDestinations(destinations, 'deals').some((item) => item.label === 'Pipeline')).toBe(true);
  });

  it('returns keyword-only matches from semantic aliases and route terms', () => {
    const destinations = companySearchDestinations(holding(['audit:view', 'accounting:view-ledger']));

    expect(searchCompanyDestinations(destinations, 'records').some((item) => item.label === 'Audit Log')).toBe(true);
    expect(searchCompanyDestinations(destinations, 'financial').some((item) => item.label === 'Accounting')).toBe(true);
    expect(searchCompanyDestinations(destinations, 'logged in devices')[0]?.label).toBe('Sessions & Devices');
  });
});

describe('power-based destinations', () => {
  const paths = (subject: ScreenAccessSubject) =>
    companySearchDestinations(subject).map((item) => item.path);

  it('offers each Recruitment tab to the holders of its view power, whatever their department', () => {
    expect(paths(holding(['recruitment:view-candidates']))).toContain('/company/recruitment/candidates');
    expect(paths(holding(['recruitment:view-candidates']))).not.toContain('/company/recruitment/offers');
    expect(paths(holding([]))).not.toContain('/company/recruitment');
  });

  it('offers Access Explorer and Organization screens to the positions holding their powers', () => {
    const viewer = paths(holding(['access:view', 'org:view-structure']));
    expect(viewer).toContain('/company/access');
    expect(viewer).toContain('/company/organization/org-chart');
    // An editor needs the power that saves it.
    expect(viewer).not.toContain('/company/organization/teams');
    expect(paths(holding(['org:view-structure', 'org:manage-teams']))).toContain('/company/organization/teams');
  });

  it('keeps self-service pages to employees', () => {
    const superAdmin = paths({ accountType: 'super-admin' });
    expect(superAdmin).not.toContain('/company/attendance/today');
    expect(superAdmin).not.toContain('/company/my-profile');
    expect(paths(holding(['attendance:view-live', 'status:punch']))).toContain('/company/attendance/today');
  });
});
