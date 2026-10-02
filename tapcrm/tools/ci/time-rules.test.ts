import { describe, expect, it } from 'vitest';
import { findDateShortcuts, findTimeLibraryImports } from './time-rules.js';

const ROOT = '/repo';
const MODULES = '/repo/packages/server/src/modules';

describe('T-2 — People modules never take a day from the database or a UTC string', () => {
  it('flags each shortcut in a People module, with its line', () => {
    const text = [
      'const a = sql`SELECT * FROM x WHERE work_date = CURRENT_DATE`;',
      'const b = sql`SELECT now()::date`;',
      'const c = new Date().toISOString().slice(0, 10);',
      "const d = new Date().toISOString().split('T')[0];",
    ].join('\n');
    const violations = findDateShortcuts([{ path: `${MODULES}/attendance/service.ts`, text }], ROOT);
    expect(violations.map((v) => [v.line, v.what])).toEqual([
      [1, 'CURRENT_DATE'],
      [2, 'now()::date'],
      [3, 'toISOString().slice(0, 10)'],
      [4, "toISOString().split('T')"],
    ]);
  });

  it('covers every People module and nothing else', () => {
    const text = 'WHERE d = current_date';
    const inPeople = ['shifts', 'holidays', 'attendance', 'live-status', 'biometric', 'leave', 'break-management', 'payroll'];
    for (const module of inPeople) {
      expect(findDateShortcuts([{ path: `${MODULES}/${module}/repository.ts`, text }], ROOT)).toHaveLength(1);
    }
    expect(findDateShortcuts([{ path: `${MODULES}/audit/integrity.ts`, text }], ROOT)).toEqual([]);
    expect(findDateShortcuts([{ path: '/repo/packages/server/src/platform/time.ts', text }], ROOT)).toEqual([]);
  });
});

describe('T-4 — one date library, wrapped once', () => {
  it('allows luxon only in platform/time.ts', () => {
    const text = "import { DateTime } from 'luxon';";
    expect(findTimeLibraryImports([{ path: '/repo/packages/server/src/platform/time.ts', text }], ROOT)).toEqual([]);
    expect(
      findTimeLibraryImports([{ path: `${MODULES}/shifts/resolver.ts`, text }], ROOT).map((v) => v.file),
    ).toEqual(['packages/server/src/modules/shifts/resolver.ts']);
  });

  it('also catches a dynamic import', () => {
    const text = "const { DateTime } = await import('luxon');";
    expect(findTimeLibraryImports([{ path: `${MODULES}/payroll/service.ts`, text }], ROOT)).toHaveLength(1);
  });
});
