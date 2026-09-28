import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';

describe('module boundary (MB-1)', () => {
  it('break-management files only import from their own module or facade.ts of siblings', () => {
    const files = globSync('packages/server/src/modules/break-management/**/*.ts', {
      ignore: ['**/*.test.ts'],
    });
    const violations: string[] = [];
    for (const file of files) {
      if (file.endsWith('facade.ts')) continue; // facade.ts is allowed to re-export
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim().startsWith('import')) continue;
        const attendanceImport = line.match(/from ['"].*modules\/attendance\/(?!facade)/);
        const payrollImport = line.match(/from ['"].*modules\/payroll\/(?!facade)/);
        const liveStatusImport = line.match(/from ['"].*modules\/live-status\/(?!facade)/);
        if (attendanceImport || payrollImport || liveStatusImport) {
          violations.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('attendance/payroll only import break-management via facade.ts', () => {
    const attendanceFiles = globSync('packages/server/src/modules/attendance/**/*.ts', {
      ignore: ['**/*.test.ts'],
    });
    const payrollFiles = globSync('packages/server/src/modules/payroll/**/*.ts', {
      ignore: ['**/*.test.ts'],
    });
    const violations: string[] = [];
    for (const file of [...attendanceFiles, ...payrollFiles]) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim().startsWith('import')) continue;
        const badImport = line.match(/from ['"].*modules\/break-management\/(?!facade)/);
        if (badImport) violations.push(`${file}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
