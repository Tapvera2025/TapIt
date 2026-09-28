import { relative } from 'node:path';
import { locateInModule, type SourceFile } from './boundary.js';

/**
 * Table ownership — attendance design §6.2 ("no other module reads the shift*
 * tables"), SH-1.
 *
 * A module's tables are read and written by that module alone; everyone else
 * asks its façade. Tests may seed any table.
 */

export const TABLE_OWNERS: readonly {
  readonly module: string;
  readonly tables: RegExp;
}[] = [
  { module: 'shifts',      tables: /^(shift|shift_[a-z_]+|department_shift_default)$/ },
  { module: 'holidays',    tables: /^(holiday|holiday_[a-z_]+)$/ },
  { module: 'attendance',  tables: /^(attendance_[a-z_]+|arrival_policy_override|arrival_exception)$/ },
  { module: 'live-status',       tables: /^user_status$/ },
  { module: 'biometric',         tables: /^biometric_[a-z_]+$/ },
  { module: 'break-management',  tables: /^(break_policy|break_policy_version|break_penalty_rule|break_policy_assignment|break_breach)$/ },
  { module: 'payroll',           tables: /^payroll_input$/ },
];

export interface TableViolation {
  readonly file: string;
  readonly line: number;
  readonly table: string;
  readonly owner: string;
}

/** SQL keywords are upper case in this codebase, which keeps prose out of the net. */
const TABLE_REFERENCE = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-z_][a-z0-9_]*)/g;

export function findForeignTableUse(
  files: readonly SourceFile[],
  root: string,
): TableViolation[] {
  const violations: TableViolation[] = [];
  for (const file of files) {
    if (file.path.endsWith('.test.ts')) continue;
    const module = locateInModule(root, file.path)?.module ?? null;
    for (const match of file.text.matchAll(TABLE_REFERENCE)) {
      const table = match[1]!;
      const owner = TABLE_OWNERS.find((candidate) => candidate.tables.test(table));
      if (owner === undefined || owner.module === module) continue;
      violations.push({
        file: relative(root, file.path),
        line: file.text.slice(0, match.index).split('\n').length,
        table,
        owner: owner.module,
      });
    }
  }
  return violations;
}
