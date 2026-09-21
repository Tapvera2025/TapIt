import { describe, expect, it } from 'vitest';
import { normalizeSpecializations } from './service.js';

describe('OR-11 designation specialization management', () => {
  it('trims specialization labels while preserving their configured order', () => {
    expect(normalizeSpecializations([' Frontend ', 'Backend'])).toEqual([
      'Frontend',
      'Backend',
    ]);
  });

  it('rejects duplicate specializations case-insensitively', () => {
    expect(() => normalizeSpecializations(['Frontend', ' frontend '])).toThrow(
      /duplicated/i,
    );
  });
});
