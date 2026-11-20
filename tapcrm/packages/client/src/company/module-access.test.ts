import { describe, expect, it } from 'vitest';
import { isActionModuleEnabled } from './module-access.js';
import { holdsPower } from './layout/navigation.js';

describe('module access', () => {
  it('requires the owning module to be enabled', () => {
    expect(isActionModuleEnabled(['social'], 'social:view')).toBe(true);
    expect(isActionModuleEnabled(['attendance'], 'social:view')).toBe(false);
  });

  it('denies unknown actions', () => {
    expect(isActionModuleEnabled(['social'], 'nope:nothing')).toBe(false);
  });

  it('does not let a super-admin bypass a disabled module', () => {
    const superAdmin = { accountType: 'super-admin', capabilities: [] };
    expect(holdsPower({ ...superAdmin, enabledModules: [] }, 'social:view')).toBe(false);
    expect(holdsPower({ ...superAdmin, enabledModules: ['social'] }, 'social:view')).toBe(true);
    expect(holdsPower({ ...superAdmin, enabledModules: [] }, { action: 'social:view', reach: 'beyond-own' })).toBe(false);
  });

  it('honours held capabilities for regular users', () => {
    const subject = {
      accountType: 'employee',
      enabledModules: ['social'],
      capabilities: [{ action: 'social:view', scope: 'own' }],
    };
    expect(holdsPower(subject, 'social:view')).toBe(true);
    expect(holdsPower(subject, { action: 'social:view', reach: 'beyond-own' })).toBe(false);
  });
});
