import { describe, expect, it } from 'vitest';
import { reminderAt, selectSalesSupervisor } from './callback-automation.js';

describe('callback reminder timing', () => {
  it('generates the three reminder instants from the persisted callback instant', () => {
    const callback = new Date('2026-09-29T05:30:00.000Z');
    expect(reminderAt(callback, 60).toISOString()).toBe('2026-09-29T04:30:00.000Z');
    expect(reminderAt(callback, 15).toISOString()).toBe('2026-09-29T05:15:00.000Z');
    expect(reminderAt(callback, 0).toISOString()).toBe('2026-09-29T05:30:00.000Z');
  });
});

describe('missed callback supervisory routing', () => {
  it('selects the nearest eligible Sales supervisor or team lead, not an arbitrary manager', () => {
    expect(selectSalesSupervisor([
      { id: 'manager', positionCode: 'engineering-manager', depth: 1 },
      { id: 'team-lead', positionCode: 'sales-team-lead', depth: 2 },
      { id: 'supervisor', positionCode: 'sales-supervisor', depth: 3 },
    ])).toBe('team-lead');
    expect(selectSalesSupervisor([])).toBeNull();
  });

  it('routes callbacks owned by Sales leadership to the next eligible Sales supervisor', () => {
    expect(selectSalesSupervisor([{ id: 'supervisor', positionCode: 'sales-supervisor', depth: 1 }])).toBe('supervisor');
    expect(selectSalesSupervisor([{ id: 'team-lead', positionCode: 'sales-team-lead', depth: 1 }, { id: 'supervisor', positionCode: 'sales-supervisor', depth: 2 }])).toBe('team-lead');
  });
});
