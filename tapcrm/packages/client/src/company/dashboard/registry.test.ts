import { describe, expect, it } from 'vitest';
import type { CompanyIdentity } from '../api/companyApi.js';
import { availableWidgets } from './registry.js';

const ALL_MODULES = ['tasks', 'leave', 'holidays', 'attendance', 'live-status', 'shifts', 'chat', 'workspace'];

function employee(
  powers: readonly string[],
  enabledModules: readonly string[] = ALL_MODULES,
): CompanyIdentity {
  return {
    user: { id: 'user-1', email: 'e@example.com', fullName: 'Employee', accountType: 'employee' },
    organization: null,
    enabledModules,
    capabilities: powers.map((action) => ({ action, scope: 'own' })),
  } as unknown as CompanyIdentity;
}

const ids = (identity: CompanyIdentity) => availableWidgets(identity).map((widget) => widget.id);

describe('personal dashboard widgets follow the same powers as the sidebar', () => {
  it('offers My open tasks, My leave and Upcoming holidays only with the power behind their data', () => {
    const none = ids(employee([]));
    expect(none).not.toContain('my-tasks');
    expect(none).not.toContain('my-leave');
    expect(none).not.toContain('upcoming-holidays');
    // Sessions are the person's own account, open to everyone.
    expect(none).toContain('my-sessions');

    const holding = ids(employee(['tasks:view', 'leave:view', 'holidays:view']));
    expect(holding).toContain('my-tasks');
    expect(holding).toContain('my-leave');
    expect(holding).toContain('upcoming-holidays');
  });

  it('drops them when the company has the module switched off', () => {
    const powers = ['tasks:view', 'leave:view', 'holidays:view'];
    const off = ids(employee(powers, ['tasks']));
    expect(off).toContain('my-tasks');
    expect(off).not.toContain('my-leave');
    expect(off).not.toContain('upcoming-holidays');
  });
});
