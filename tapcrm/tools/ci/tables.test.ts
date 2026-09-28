import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findForeignTableUse } from './tables.js';

const ROOT = '/repo';
const file = (path: string, text: string) => ({ path: resolve(ROOT, path), text });

describe('SH-1 — only shifts reads the shift tables (design §6.2)', () => {
  it('flags another module reading shift_assignment', () => {
    const found = findForeignTableUse(
      [
        file(
          'packages/server/src/modules/attendance/repository.ts',
          'sql`SELECT * FROM shift_assignment WHERE …`',
        ),
      ],
      ROOT,
    );
    expect(found).toEqual([
      {
        file: 'packages/server/src/modules/attendance/repository.ts',
        line: 1,
        table: 'shift_assignment',
        owner: 'shifts',
      },
    ]);
  });

  it('flags platform code too', () => {
    const found = findForeignTableUse(
      [file('packages/server/src/platform/report.ts', 'JOIN shift s ON')],
      ROOT,
    );
    expect(found).toHaveLength(1);
  });

  it('lets shifts use its own tables, and tests seed anything', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/shifts/repository.ts',
            'INSERT INTO shift_version',
          ),
          file(
            'packages/server/src/modules/attendance/day.test.ts',
            'INSERT INTO shift_override',
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('ignores prose and other tables', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/leave/service.ts',
            '// read from shift settings\nFROM leave_request',
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });
});

describe('MB-4 — the same rule covers holidays (design §7)', () => {
  it('another module reading holiday_scope is flagged', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/attendance/repository.ts',
            'sql`SELECT * FROM holiday_scope WHERE …`',
          ),
        ],
        ROOT,
      ),
    ).toEqual([
      {
        file: 'packages/server/src/modules/attendance/repository.ts',
        line: 1,
        table: 'holiday_scope',
        owner: 'holidays',
      },
    ]);
  });

  it('holidays reading shift directly is flagged (must go through the shifts facade)', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/holidays/repository.ts',
            'sql`SELECT id FROM shift WHERE …`',
          ),
        ],
        ROOT,
      ),
    ).toEqual([
      {
        file: 'packages/server/src/modules/holidays/repository.ts',
        line: 1,
        table: 'shift',
        owner: 'shifts',
      },
    ]);
  });

  it('holidays reading its own tables is fine', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/holidays/repository.ts',
            'INSERT INTO holiday_scope',
          ),
          file(
            'packages/server/src/modules/holidays/service.ts',
            'UPDATE holiday SET status',
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });
});

describe('BM-1 — break-management and payroll table ownership', () => {
  it('attendance reading break_breach directly is flagged (must go through facade)', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/attendance/repository.ts',
            'SELECT * FROM break_breach WHERE …',
          ),
        ],
        ROOT,
      ),
    ).toEqual([
      {
        file: 'packages/server/src/modules/attendance/repository.ts',
        line: 1,
        table: 'break_breach',
        owner: 'break-management',
      },
    ]);
  });

  it('break-management reading payroll_input directly is flagged (must go through facade)', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/break-management/repository.ts',
            'SELECT * FROM payroll_input WHERE …',
          ),
        ],
        ROOT,
      ),
    ).toEqual([
      {
        file: 'packages/server/src/modules/break-management/repository.ts',
        line: 1,
        table: 'payroll_input',
        owner: 'payroll',
      },
    ]);
  });

  it('break-management reading its own break_policy is fine', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/break-management/repository.ts',
            'SELECT * FROM break_policy WHERE …',
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('payroll reading payroll_input is fine', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/payroll/repository.ts',
            'INSERT INTO payroll_input VALUES …',
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });
});
