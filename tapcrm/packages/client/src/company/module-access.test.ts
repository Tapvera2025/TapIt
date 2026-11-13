import { describe, expect, it } from 'vitest';
import {
  isActionModuleEnabled,
  superAdminOr,
  superAdminOrBeyondOwn,
} from './module-access.js';

describe('module access', () => {
  it('requires the owning module to be enabled', () => {
    expect(isActionModuleEnabled(['social'], 'social:view')).toBe(true);
    expect(isActionModuleEnabled(['attendance'], 'social:view')).toBe(false);
  });

  it('denies unknown actions', () => {
    expect(isActionModuleEnabled(['social'], 'nope:nothing')).toBe(false);
  });

  it('does not let a super-admin bypass a disabled module', () => {
    const base = { isSuperAdmin: true, capabilities: [] };
    expect(superAdminOr({ ...base, enabledModules: [] }, 'social:view')).toBe(false);
    expect(superAdminOr({ ...base, enabledModules: ['social'] }, 'social:view')).toBe(true);
    expect(superAdminOrBeyondOwn({ ...base, enabledModules: [] }, 'social:view')).toBe(false);
  });

  it('honours held capabilities for regular users', () => {
    const subject = {
      isSuperAdmin: false,
      enabledModules: ['social'],
      capabilities: [{ action: 'social:view', scope: 'own' }],
    };
    expect(superAdminOr(subject, 'social:view')).toBe(true);
    expect(superAdminOrBeyondOwn(subject, 'social:view')).toBe(false);
  });
});
