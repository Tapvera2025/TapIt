import { describe, expect, it } from 'vitest';
import { MODULES } from './module.js';
import {
  PLATFORM_AUTOMATIC_MODULES,
  PLATFORM_MODULE_GROUPS,
  PLATFORM_SELECTABLE_MODULES,
  PLATFORM_UNRELEASED_MODULES,
  isPlatformSelectableModule,
  platformModuleGroupOf,
  unplacedPlatformModules,
} from './platform-modules.js';

describe('Master Admin module catalogue', () => {
  it('places every module in exactly one bucket', () => {
    expect(unplacedPlatformModules()).toEqual([]);
    const all = [
      ...PLATFORM_SELECTABLE_MODULES,
      ...PLATFORM_AUTOMATIC_MODULES,
      ...PLATFORM_UNRELEASED_MODULES,
    ];
    expect(all.length).toBe(new Set(all).size);
    expect(new Set(all)).toEqual(new Set(MODULES));
  });

  it('puts each selectable module in one group only', () => {
    const counts = new Map<string, number>();
    for (const group of PLATFORM_MODULE_GROUPS)
      for (const key of group.moduleKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
    expect([...counts].filter(([, count]) => count > 1)).toEqual([]);
  });

  it('offers the modules that were gated without a switch', () => {
    for (const key of ['social', 'meetings', 'seo-intelligence', 'ta', 'advance', 'penalties']) {
      expect(isPlatformSelectableModule(key)).toBe(true);
    }
    expect(platformModuleGroupOf('seo-intelligence')?.key).toBe('marketing');
    expect(isPlatformSelectableModule('identity')).toBe(false);
    expect(isPlatformSelectableModule('reporting')).toBe(false);
  });
});
