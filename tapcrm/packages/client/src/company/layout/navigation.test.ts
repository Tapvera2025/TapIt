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
});
