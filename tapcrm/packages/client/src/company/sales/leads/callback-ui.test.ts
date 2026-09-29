import { describe, expect, it } from 'vitest';
import { organizationLocalToIso } from './callback-ui.js';

describe('callback organization timezone conversion', () => {
  it('converts organization-local handover callback time to an instant', () => {
    expect(organizationLocalToIso('2026-09-29T11:00', 'Asia/Kolkata')).toBe('2026-09-29T05:30:00.000Z');
  });
});
