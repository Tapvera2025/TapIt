import type { DateOnly } from '@tapcrm/contracts';
import { addDays, daysBetween } from '../../platform/time.js';
import { rupeesToPaise, roundToRupee, prorateAndRound } from './money.js';

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
  readonly sourceId: string | null;  // break_breach_id or null
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
