import type { DateOnly } from '@tapcrm/contracts';
import { addDays, daysBetween } from '../../platform/time.js';
import { rupeesToPaise, roundToRupee, prorateAndRound } from './money.js';

/**
 * Which calculation produced a payslip. Frozen into each employee's inputs, so
 * it is part of the fingerprint: a run calculated by an older engine reads as
 * changed and is recalculated before it can be published. Published payslips
 * are never touched; a revision recalculates with the current engine.
 *   2: statutory lines from the accepted settings (PY-4), overtime and holiday
 *      work when the settings pay for them, advance recoveries and penalties.
 */
export const PAYROLL_ENGINE_VERSION = 'payroll-engine/2';

export interface FrozenDay {
  readonly workDate: string;
  readonly state: 'open' | 'closed';
  readonly presentUnits: number;
  readonly paidLeaveUnits: number;
  readonly unpaidLeaveUnits: number;
  readonly absentUnits: number;
  readonly holidayUnits: number;
  readonly nightMinutes: number;
  readonly overtimeMinutes: number;
  /** Minutes worked on a holiday or weekly off; present only on such days. */
  readonly holidayWorkedMinutes?: number;
}

export interface FrozenStructureSegment {
  readonly structureId: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly lines: FrozenStructureLine[];
}

export interface FrozenStructureLine {
  readonly code: string;
  readonly label: string;
  readonly kind: 'earning' | 'deduction' | 'employer-contribution';
  readonly amountStr: string;  // numeric string (rupees)
  readonly prorated: boolean;
  readonly statutoryTags: string[];
  readonly sortOrder: number;
}

export interface FrozenInput {
  readonly id: string;
  readonly kind: string;
  readonly amountStr: string;  // numeric string
  readonly label: string;
  readonly direction: 'earning' | 'deduction';
  readonly sourceId: string | null;  // break breach, advance deduction or penalty; null for manual entries
}

export interface FrozenConfig {
  readonly schemaVersion: string;
  readonly settings: Record<string, unknown>;
}

export interface ComputePayslipInput {
  readonly userId: string;
  readonly periodStart: string;  // YYYY-MM-DD first of month
  readonly periodEnd: string;    // YYYY-MM-DD last of month
  readonly employmentFrom: string;
  readonly employmentTo: string | null;
  readonly days: FrozenDay[];
  readonly structureSegments: FrozenStructureSegment[];
  readonly inputs: FrozenInput[];
  readonly config: FrozenConfig;
}

export interface PayslipLine {
  readonly code: string;
  readonly label: string;
  readonly kind: 'earning' | 'deduction' | 'employer-contribution';
  readonly amountPaise: bigint;
  readonly basis: Record<string, unknown>;
  readonly sortOrder: number;
}

export interface ComputePayslipResult {
  readonly grossPaise: bigint;
  readonly deductionsPaise: bigint;
  readonly netPaise: bigint;
  readonly employerContributionPaise: bigint;
  readonly lines: PayslipLine[];
  readonly totalUnits: number;
  readonly paidUnits: number;
  readonly unpaidUnits: number;
}

/**
 * Compute a payslip from frozen inputs. Pure, deterministic, no I/O.
 *
 * A month of D days has 2D units. Paid units are the employed days' units less
 * the unpaid-leave and absent units recorded on them (design §9, Task 3): paid
 * leave, holidays and week-offs stay paid, and so does an employed day that
 * carries no attendance row or no judgement (a no-shift day, or a day before
 * the company began recording attendance). Dates outside the employment window
 * carry no salary whether or not a row exists.
 */
export function computePayslip(input: ComputePayslipInput): ComputePayslipResult {
  // Count days in the period
  const periodDays = countDaysInRange(input.periodStart, input.periodEnd);
  const totalUnits = periodDays * 2;

  // 1–2. Employed units in the period, less recorded loss of pay.
  const employed = employedRange(input.periodStart, input.periodEnd, input.employmentFrom, input.employmentTo);
  const unpaidUnits = employed === null ? 0 : lossUnitsIn(input.days, employed.from, employed.to);
  const paidUnits = employed === null
    ? 0
    : Math.max(0, countDaysInRange(employed.from, employed.to) * 2 - unpaidUnits);

  // 3. Compute structure lines
  const lines: PayslipLine[] = [];

  // Group days by structure segment (last segment wins for non-prorated)
  // Sort segments by effectiveFrom ascending
  const segments = [...input.structureSegments].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0,
  );

  // For prorated lines: compute paid units per segment
  // For non-prorated: use the segment in effect on the last employed day in the month
  const lastEmployedDay = employed?.to ?? null;
  const nonProratedSegment = lastEmployedDay
    ? segments.filter(s => s.effectiveFrom <= lastEmployedDay).pop() ?? segments[0]
    : segments[0];

  // Collect all unique line codes across segments for non-prorated
  const nonProratedCodes = new Set<string>();
  if (nonProratedSegment) {
    for (const line of nonProratedSegment.lines) {
      if (!line.prorated) nonProratedCodes.add(line.code);
    }
  }

  // Build prorated line amounts summed across segments
  const proratedAmounts = new Map<string, { label: string; kind: FrozenStructureLine['kind']; paise: bigint; sortOrder: number; basis: Record<string, unknown> }>();

  for (const segment of segments) {
    // Count paid units within this segment's date range
    const segPaidUnits = countPaidUnitsInSegment(input.days, segment, input.periodStart, input.periodEnd, input.employmentFrom, input.employmentTo);
    for (const line of segment.lines) {
      if (!line.prorated || nonProratedCodes.has(line.code)) continue;
      const amountPaise = rupeesToPaise(line.amountStr);
      const segPaise = prorateAndRound(amountPaise, segPaidUnits, totalUnits);
      const existing = proratedAmounts.get(line.code);
      if (existing) {
        proratedAmounts.set(line.code, { ...existing, paise: existing.paise + segPaise });
      } else {
        proratedAmounts.set(line.code, {
          label: line.label,
          kind: line.kind,
          paise: segPaise,
          sortOrder: line.sortOrder,
          basis: { prorated: true, segments: segments.length, paidUnits, totalUnits },
        });
      }
    }
  }

  // Add prorated lines
  for (const [code, v] of proratedAmounts) {
    lines.push({ code, label: v.label, kind: v.kind, amountPaise: roundToRupee(v.paise), basis: v.basis, sortOrder: v.sortOrder });
  }

  // Add non-prorated lines from the last-employed-day segment
  if (nonProratedSegment) {
    for (const line of nonProratedSegment.lines) {
      if (line.prorated) continue;
      lines.push({
        code: line.code,
        label: line.label,
        kind: line.kind,
        amountPaise: roundToRupee(rupeesToPaise(line.amountStr)),
        basis: { prorated: false, structureId: nonProratedSegment.structureId },
        sortOrder: line.sortOrder,
      });
    }
  }

  // 3b. Overtime and work on holidays, when the month's settings pay for them.
  addExtraTimePay(lines, nonProratedSegment ?? segments[segments.length - 1], input.days, input.config.settings);

  // 3c. Statutory lines from the month's accepted settings (PY-4).
  applyStatutorySettings(lines, segments, input.config.settings);

  // 4. Add payroll inputs as lines
  for (const inp of input.inputs) {
    const amountPaise = roundToRupee(rupeesToPaise(inp.amountStr));
    lines.push({
      code: `input:${inp.kind}`,
      label: inp.label,
      kind: inp.direction,
      amountPaise,
      basis: { inputId: inp.id, inputKind: inp.kind, sourceId: inp.sourceId },
      sortOrder: 9000 + lines.length,
    });
  }

  // 5. Sort lines
  lines.sort((a, b) => a.sortOrder - b.sortOrder);

  // 6. Sum totals (sum the already-rounded displayed lines)
  let grossPaise = 0n;
  let deductionsPaise = 0n;
  let employerContributionPaise = 0n;
  for (const line of lines) {
    if (line.kind === 'earning') grossPaise += line.amountPaise;
    else if (line.kind === 'deduction') deductionsPaise += line.amountPaise;
    else if (line.kind === 'employer-contribution') employerContributionPaise += line.amountPaise;
  }
  const netPaise = grossPaise - deductionsPaise;

  return { grossPaise, deductionsPaise, netPaise, employerContributionPaise, lines, totalUnits, paidUnits, unpaidUnits };
}

// ── overtime and holiday work ────────────────────────────────────────────────

/**
 * Paid only when the month's settings switch it on:
 *   overtime:     { enabled, multiplier? = 2 }
 *   holidayWork:  { enabled, multiplier? = 2 }
 *   ordinaryRate: { workingDaysPerMonth? = 26, hoursPerDay? = 8 }
 * The hourly ordinary rate is the monthly wage of the lines tagged `pf-wage`
 * (basic and DA) over working days × hours. Overtime is the credited overtime
 * of working days; holiday work is the time worked on holidays and weekly offs.
 */
function addExtraTimePay(
  lines: PayslipLine[],
  segment: FrozenStructureSegment | undefined,
  days: readonly FrozenDay[],
  settings: Record<string, unknown>,
): void {
  const overtime = obj(settings['overtime']);
  const holidayWork = obj(settings['holidayWork']);
  const otOn = overtime?.['enabled'] === true;
  const holidayOn = holidayWork?.['enabled'] === true;
  if ((!otOn && !holidayOn) || segment === undefined) return;
  const ordinary = obj(settings['ordinaryRate']);
  const daysPerMonth = num(ordinary?.['workingDaysPerMonth']) ?? 26;
  const hoursPerDay = num(ordinary?.['hoursPerDay']) ?? 8;
  if (daysPerMonth <= 0 || hoursPerDay <= 0) return;
  const wagePaise = segment.lines
    .filter((line) => line.kind === 'earning' && line.statutoryTags.includes('pf-wage'))
    .reduce((sum, line) => sum + rupeesToPaise(line.amountStr), 0n);
  if (wagePaise === 0n) return;
  // pay = wage × minutes × multiplier / (days × hours × 60), to the rupee, half up,
  // computed exactly with the decimals scaled to thousandths.
  const pay = (minutes: number, multiplier: number): bigint => {
    const m = BigInt(Math.round(multiplier * 1000));
    const d = BigInt(Math.round(daysPerMonth * 1000));
    const h = BigInt(Math.round(hoursPerDay * 1000));
    const numerator = wagePaise * BigInt(minutes) * m * 1000n;
    const denominator = d * h * 60n;
    return ((numerator + 50n * denominator) / (100n * denominator)) * 100n;
  };
  const rateBasis = { wagePaise: wagePaise.toString(), workingDaysPerMonth: daysPerMonth, hoursPerDay };
  if (otOn) {
    const minutes = days.reduce((sum, day) => sum + (day.overtimeMinutes ?? 0), 0);
    const multiplier = num(overtime?.['multiplier']) ?? 2;
    if (minutes > 0)
      lines.push({
        code: 'OVERTIME', label: 'Overtime', kind: 'earning', amountPaise: pay(minutes, multiplier),
        basis: { overtimeMinutes: minutes, multiplier, ...rateBasis }, sortOrder: 8000,
      });
  }
  if (holidayOn) {
    const minutes = days.reduce((sum, day) => sum + (day.holidayWorkedMinutes ?? 0), 0);
    const multiplier = num(holidayWork?.['multiplier']) ?? 2;
    if (minutes > 0)
      lines.push({
        code: 'HOLIDAY-WORK', label: 'Work on holidays and weekly offs', kind: 'earning',
        amountPaise: pay(minutes, multiplier),
        basis: { holidayWorkedMinutes: minutes, multiplier, ...rateBasis }, sortOrder: 8001,
      });
  }
}

// ── statutory settings (PY-4) ────────────────────────────────────────────────

/**
 * The statutory parts of the accepted settings. Each is optional: a setting
 * that is missing leaves the salary structure's own amount for that line, so
 * months accepted without statutory settings calculate exactly as before.
 *
 *   pf:              { employeeRate, employerRate, wageCeiling? }   rates as fractions (0.12)
 *   professionalTax: { monthly }                                     rupees per month
 *   esi:             { enabled, employeeRate?, employerRate?, wageLimit? }
 */
export interface StatutorySettings {
  readonly pf: { employeeRate: number; employerRate: number; wageCeilingPaise: bigint | null } | null;
  readonly professionalTaxPaise: bigint | null;
  readonly esi: { enabled: boolean; employeeRate: number; employerRate: number; wageLimitPaise: bigint } | null;
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0
      ? Number(value)
      : null;
const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export function statutorySettings(settings: Record<string, unknown>): StatutorySettings {
  const pf = obj(settings['pf']);
  const pt = obj(settings['professionalTax']);
  const esi = obj(settings['esi']);
  const pfEmployee = pf ? num(pf['employeeRate']) : null;
  const pfEmployer = pf ? num(pf['employerRate']) : null;
  const pfCeiling = pf ? num(pf['wageCeiling']) : null;
  const ptMonthly = pt ? num(pt['monthly']) : null;
  return {
    pf:
      pfEmployee !== null && pfEmployer !== null
        ? {
            employeeRate: pfEmployee,
            employerRate: pfEmployer,
            wageCeilingPaise: pfCeiling !== null && pfCeiling > 0 ? rupeesToPaise(pfCeiling) : null,
          }
        : null,
    professionalTaxPaise: ptMonthly !== null ? rupeesToPaise(ptMonthly) : null,
    esi:
      esi !== null && typeof esi['enabled'] === 'boolean'
        ? {
            enabled: esi['enabled'],
            employeeRate: num(esi['employeeRate']) ?? 0.0075,
            employerRate: num(esi['employerRate']) ?? 0.0325,
            wageLimitPaise: rupeesToPaise(num(esi['wageLimit']) ?? 21000),
          }
        : null,
  };
}

const STATUTORY_TAGS: readonly string[] = ['pf-wage', 'pf', 'pt', 'esi'];

/**
 * The settings define PF, PT or ESI, but no salary line is marked for any of
 * them, so they would quietly not apply: PF stays whatever fixed amount was
 * typed and ESI is never deducted. The run reports it as a warning.
 */
export function statutoryUnmarked(
  segments: readonly FrozenStructureSegment[],
  settings: Record<string, unknown>,
): boolean {
  if (segments.length === 0) return false;
  const rules = statutorySettings(settings);
  if (rules.pf === null && rules.professionalTaxPaise === null && rules.esi === null) return false;
  return !segments.some((segment) =>
    segment.lines.some((line) => line.statutoryTags.some((tag) => STATUTORY_TAGS.includes(tag))),
  );
}

/** `paise × rate`, exact to six decimal places of the rate, then rounded to the rupee (PY-3). */
function percentOf(paise: bigint, rate: number): bigint {
  const micro = BigInt(Math.round(rate * 1_000_000));
  // Rounded half-up to the rupee in one step: (paise × micro) / (10⁶ × 100) rupees.
  return ((paise * micro + 50_000_000n) / 100_000_000n) * 100n;
}

/**
 * Replaces the amounts of structure lines tagged `pf`, `pt` or `esi` with what
 * the settings say, from the earned (already prorated) lines:
 *   PF  — the rate of the earned `pf-wage` lines, capped at the wage ceiling;
 *         the deduction takes the employee rate, the employer line its own
 *   PT  — the monthly amount
 *   ESI — the rate of gross earnings when gross is within the wage limit,
 *         nothing (the line is dropped) above it or when ESI is off
 */
function applyStatutorySettings(
  lines: PayslipLine[],
  segments: readonly FrozenStructureSegment[],
  settings: Record<string, unknown>,
): void {
  const rules = statutorySettings(settings);
  if (rules.pf === null && rules.professionalTaxPaise === null && rules.esi === null) return;
  const tags = new Map<string, readonly string[]>();
  for (const segment of segments) for (const line of segment.lines) tags.set(line.code, line.statutoryTags);
  const tagged = (line: PayslipLine, tag: string) => (tags.get(line.code) ?? []).includes(tag);

  const pfWage = lines
    .filter((line) => line.kind === 'earning' && tagged(line, 'pf-wage'))
    .reduce((sum, line) => sum + line.amountPaise, 0n);
  const gross = lines
    .filter((line) => line.kind === 'earning')
    .reduce((sum, line) => sum + line.amountPaise, 0n);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (line.kind === 'earning') continue;
    if (rules.pf !== null && tagged(line, 'pf')) {
      const base =
        rules.pf.wageCeilingPaise !== null && pfWage > rules.pf.wageCeilingPaise
          ? rules.pf.wageCeilingPaise
          : pfWage;
      const rate = line.kind === 'deduction' ? rules.pf.employeeRate : rules.pf.employerRate;
      lines[i] = {
        ...line,
        amountPaise: percentOf(base, rate),
        basis: { statutory: 'pf', pfWagePaise: pfWage.toString(), basePaise: base.toString(), rate },
      };
    } else if (rules.professionalTaxPaise !== null && tagged(line, 'pt')) {
      lines[i] = {
        ...line,
        amountPaise: gross > 0n ? rules.professionalTaxPaise : 0n,
        basis: { statutory: 'pt', monthlyPaise: rules.professionalTaxPaise.toString() },
      };
    } else if (rules.esi !== null && tagged(line, 'esi')) {
      if (!rules.esi.enabled || gross > rules.esi.wageLimitPaise) {
        lines.splice(i, 1);
        continue;
      }
      const rate = line.kind === 'deduction' ? rules.esi.employeeRate : rules.esi.employerRate;
      lines[i] = {
        ...line,
        amountPaise: percentOf(gross, rate),
        basis: { statutory: 'esi', grossPaise: gross.toString(), rate },
      };
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function countDaysInRange(from: string, to: string): number {
  return daysBetween(from as DateOnly, to as DateOnly) + 1;
}

/** The calendar day before `date` (YYYY-MM-DD). */
function dayBefore(date: string): string {
  return addDays(date as DateOnly, -1);
}

/** The inclusive intersection of the period and the employment window, or null. */
function employedRange(
  periodStart: string,
  periodEnd: string,
  empFrom: string,
  empTo: string | null,
): { from: string; to: string } | null {
  const from = empFrom > periodStart ? empFrom : periodStart;
  const to = empTo !== null && empTo < periodEnd ? empTo : periodEnd;
  return from > to ? null : { from, to };
}

/** Unpaid-leave and absent units recorded on days in [from, to]. */
function lossUnitsIn(days: FrozenDay[], from: string, to: string): number {
  let loss = 0;
  for (const day of days) {
    if (day.workDate < from || day.workDate > to) continue;
    loss += day.unpaidLeaveUnits + day.absentUnits;
  }
  return loss;
}

/**
 * Paid units for the employed dates a salary segment covers. A segment's
 * `effectiveTo` is exclusive, as in `salary_structure`.
 */
function countPaidUnitsInSegment(
  days: FrozenDay[],
  segment: FrozenStructureSegment,
  periodStart: string,
  periodEnd: string,
  empFrom: string,
  empTo: string | null,
): number {
  const employed = employedRange(periodStart, periodEnd, empFrom, empTo);
  if (employed === null) return 0;
  const from = segment.effectiveFrom > employed.from ? segment.effectiveFrom : employed.from;
  const segmentLast = segment.effectiveTo === null ? null : dayBefore(segment.effectiveTo);
  const to = segmentLast !== null && segmentLast < employed.to ? segmentLast : employed.to;
  if (from > to) return 0;
  return Math.max(0, countDaysInRange(from, to) * 2 - lossUnitsIn(days, from, to));
}
