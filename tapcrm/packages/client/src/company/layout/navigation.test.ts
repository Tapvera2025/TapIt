import { describe, expect, it } from 'vitest';
import { companySearchDestinations } from './navigation.js';
import { searchCompanyDestinations } from './GlobalFeatureSearch.js';

describe('company feature search', () => {
  it('derives accessible destinations from navigation and action capabilities', () => {
    const destinations = companySearchDestinations({ actions: new Set() });

    expect(destinations.some((item) => item.label === 'Dashboard')).toBe(true);
    expect(destinations.some((item) => item.label === 'Clients')).toBe(false);
    expect(destinations.some((item) => item.label === 'Settings')).toBe(true);
  });

  it('includes action-gated destinations only when the capability is present', () => {
    const destinations = companySearchDestinations({
      actions: new Set(['clients:view', 'projects:view']),
    });

    expect(destinations.some((item) => item.label === 'Clients')).toBe(true);
    expect(destinations.some((item) => item.label === 'Projects')).toBe(true);
    expect(destinations.some((item) => item.label === 'Employees')).toBe(false);
  });

  it('supports exact, partial, case-insensitive and category matching', () => {
    const destinations = companySearchDestinations({ actions: new Set() });

    expect(searchCompanyDestinations(destinations, 'dashboard')[0]?.label).toBe(
      'Dashboard',
    );
    expect(searchCompanyDestinations(destinations, 'Task')[0]?.label).toBe('Tasks');
    expect(searchCompanyDestinations(destinations, 'TODO')[0]?.label).toBe('My Todo');
    expect(searchCompanyDestinations(destinations, 'overview').length).toBeGreaterThan(0);
    expect(searchCompanyDestinations(destinations, 'does-not-exist')).toHaveLength(0);
  });

  it('matches short keywords and multi-word searches across accessible destinations', () => {
    const destinations = companySearchDestinations({
      actions: new Set(['attendance:view-live', 'payroll:manage', 'payroll:manage-config']),
    });

    const wResults = searchCompanyDestinations(destinations, 'W');
    expect(wResults.some((item) => item.label === 'Workforce Board')).toBe(true);
    expect(wResults.some((item) => item.label === 'Dashboard')).toBe(false);
    expect(wResults.some((item) => item.label === 'Holidays')).toBe(false);
    expect(wResults.some((item) => item.label === 'My Attendance')).toBe(false);
    expect(searchCompanyDestinations(destinations, 'payroll settings')[0]?.label).toBe('Payroll Settings');
  });

  it('supports calendar and audit aliases without bypassing permissions', () => {
    const destinations = companySearchDestinations({
      actions: new Set(['audit:view']),
    });

    expect(searchCompanyDestinations(destinations, 'weekends')[0]?.label).toBe('Holidays');
    expect(searchCompanyDestinations(destinations, 'audit trail')[0]?.label).toBe('Audit Log');
    expect(companySearchDestinations({ actions: new Set() }).some((item) => item.label === 'Audit Log')).toBe(false);
  });

  it('indexes every conditional sidebar destination with its matching capability', () => {
    const destinations = companySearchDestinations({
      actions: new Set([
        'deals:view',
        'deals:record-win',
        'deals:forecast',
        'approvals:decide',
        'shifts:manage',
        'payroll:manage',
        'accounting:view-ledger',
        'access:request-role-change',
      ]),
      hasInterviews: true,
      accountType: 'employee',
    });

    for (const label of ['My Interviews', 'Deals', 'Approvals', 'Wins to record', 'Reports', 'Weekday Schedules', 'Payroll Cycle', 'Accounting', 'Request Role Change']) {
      expect(destinations.some((item) => item.label === label)).toBe(true);
    }
    expect(searchCompanyDestinations(destinations, 'win record')[0]?.label).toBe('Wins to record');
  });

  it('returns keyword-only matches from semantic aliases and route terms', () => {
    const destinations = companySearchDestinations({
      actions: new Set(['audit:view', 'accounting:view-ledger']),
    });

    expect(searchCompanyDestinations(destinations, 'records').some((item) => item.label === 'Audit Log')).toBe(true);
    expect(searchCompanyDestinations(destinations, 'financial').some((item) => item.label === 'Accounting')).toBe(true);
    expect(searchCompanyDestinations(destinations, 'logged in devices')[0]?.label).toBe('Sessions & Devices');
  });
});

describe('power-based destinations', () => {
  it('offers Recruitment to non-HR holders of a recruitment view power', () => {
    const labels = (input: Parameters<typeof companySearchDestinations>[0]) =>
      companySearchDestinations(input).map((item) => item.path);
    expect(
      labels({ actions: new Set(['recruitment:view-candidates']), hasRecruitment: true }),
    ).toContain('/company/recruitment');
    expect(labels({ actions: new Set(), hasRecruitment: true })).not.toContain(
      '/company/recruitment',
    );
  });

  it('offers Access Explorer to access:view holders but Organization only to super-admins', () => {
    const paths = companySearchDestinations({
      actions: new Set(['access:view', 'org:view-structure']),
    }).map((item) => item.path);
    expect(paths).toContain('/company/access');
    expect(paths).not.toContain('/company/organization/teams');
  });
});
