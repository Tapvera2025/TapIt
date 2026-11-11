import type { StructureLineKind } from '../api/payrollApi.js';

/** What payroll settings use a line for: PF wage on earnings; PF, PT or ESI on the rest. */
export type Statutory = '' | 'pf-wage' | 'pf' | 'pt' | 'esi';

export const STATUTORY_LABELS: Record<Exclude<Statutory, ''>, string> = {
  'pf-wage': 'PF wage',
  pf: 'PF',
  pt: 'PT',
  esi: 'ESI',
};

export function statutoryOptions(kind: StructureLineKind): Exclude<Statutory, ''>[] {
  if (kind === 'earning') return ['pf-wage'];
  if (kind === 'deduction') return ['pf', 'pt', 'esi'];
  return ['pf', 'esi'];
}

/** Salaries saved before lines could be marked: suggest a mark from the usual codes. */
export function guessStatutory(code: string, kind: StructureLineKind): Statutory {
  const c = code.toUpperCase();
  if (kind === 'earning') return c === 'BASIC' || c === 'DA' ? 'pf-wage' : '';
  if (kind === 'deduction') {
    if (['PF', 'EPF', 'PF_EE'].includes(c)) return 'pf';
    if (['PT', 'PROFESSIONAL_TAX'].includes(c)) return 'pt';
    if (['ESI', 'ESIC', 'ESI_EE'].includes(c)) return 'esi';
    return '';
  }
  if (['PF_ER', 'EPF_ER'].includes(c)) return 'pf';
  if (['ESI_ER', 'ESIC_ER'].includes(c)) return 'esi';
  return '';
}

/** A PF, PT or ESI deduction or employer line is worked out from the settings, so its amount may be left empty. */
export const worksOutItself = (line: { kind: StructureLineKind; statutory: Statutory }): boolean =>
  line.kind !== 'earning' && line.statutory !== '';
