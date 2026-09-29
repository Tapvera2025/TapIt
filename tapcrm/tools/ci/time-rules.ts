import { relative, sep } from 'node:path';
import { locateInModule, type SourceFile } from './boundary.js';

/**
 * Time rules — attendance design §5.1.
 *
 * T-2  People modules take a day from the shifts façade or from
 *      platform/time.ts in the organization's timezone — never from the
 *      database's date or from a UTC string. `toISOString().slice(0, 10)` read
 *      the previous day before 05:30 IST in the old system (L19).
 * T-4  One date library, wrapped once in platform/time.ts, so replacing it is
 *      a one-file change.
 */

export const PEOPLE_MODULES: readonly string[] = [
  'shifts',
  'holidays',
  'attendance',
  'live-status',
  'biometric',
  'leave',
  'break-management',
  'payroll',
];

export interface TimeRuleViolation {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

const DATE_SHORTCUTS: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /\bCURRENT_DATE\b/gi, what: 'CURRENT_DATE' },
  { pattern: /\bnow\(\)\s*::\s*date\b/gi, what: 'now()::date' },
  { pattern: /\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/g, what: 'toISOString().slice(0, 10)' },
  { pattern: /\.toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)/g, what: "toISOString().split('T')" },
];

const LUXON_IMPORT = /\bfrom\s*['"]luxon['"]|\bimport\(\s*['"]luxon['"]\s*\)|\brequire\(\s*['"]luxon['"]\s*\)/g;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

export function findDateShortcuts(files: readonly SourceFile[], root: string): TimeRuleViolation[] {
  const violations: TimeRuleViolation[] = [];
  for (const file of files) {
    const location = locateInModule(root, file.path);
    if (location === null || !PEOPLE_MODULES.includes(location.module)) continue;
    for (const { pattern, what } of DATE_SHORTCUTS) {
      for (const match of file.text.matchAll(pattern)) {
        violations.push({ file: relative(root, file.path), line: lineOf(file.text, match.index), what });
      }
    }
  }
  return violations;
}

export function findTimeLibraryImports(files: readonly SourceFile[], root: string): TimeRuleViolation[] {
  const allowed = ['packages', 'server', 'src', 'platform', 'time.ts'].join(sep);
  const violations: TimeRuleViolation[] = [];
  for (const file of files) {
    const path = relative(root, file.path);
    if (path === allowed) continue;
    for (const match of file.text.matchAll(LUXON_IMPORT)) {
      violations.push({ file: path, line: lineOf(file.text, match.index), what: 'luxon' });
    }
  }
  return violations;
}
