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

/** Compute a payslip from frozen inputs. Pure, deterministic, no I/O. */
export function computePayslip(input: ComputePayslipInput): ComputePayslipResult {
  // 1. Determine the employment intersection with the period
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  const empFrom = new Date(input.employmentFrom);
  const empTo = input.employmentTo ? new Date(input.employmentTo) : null;

  // Count days in the period
  const periodDays = countDaysInRange(input.periodStart, input.periodEnd);
  const totalUnits = periodDays * 2;

  // 2. Sum units from frozen days within employment intersection
  let paidUnits = 0;
  let unpaidUnits = 0;
  for (const day of input.days) {
    const d = new Date(day.workDate);
    // Check within employment window
    if (d < empFrom) continue;
    if (empTo !== null && d > empTo) continue;
    if (d < periodStart || d > periodEnd) continue;
    paidUnits += day.presentUnits + day.paidLeaveUnits + day.holidayUnits;
    unpaidUnits += day.unpaidLeaveUnits + day.absentUnits;
  }

  // 3. Compute structure lines
  const lines: PayslipLine[] = [];

  // Group days by structure segment (last segment wins for non-prorated)
  // Sort segments by effectiveFrom ascending
  const segments = [...input.structureSegments].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0,
  );

  // For prorated lines: compute paid units per segment
  // For non-prorated: use the segment in effect on the last employed day in the month
  const lastEmployedDay = findLastEmployedDay(input.days, input.periodEnd, input.employmentFrom, input.employmentTo);
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
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

function findLastEmployedDay(
  days: FrozenDay[],
  periodEnd: string,
  empFrom: string,
  empTo: string | null,
): string | null {
  const sorted = [...days]
    .filter(d => d.workDate <= periodEnd && d.workDate >= empFrom && (empTo === null || d.workDate <= empTo))
    .sort((a, b) => (a.workDate < b.workDate ? 1 : -1));
  return sorted[0]?.workDate ?? null;
}

function countPaidUnitsInSegment(
  days: FrozenDay[],
  segment: FrozenStructureSegment,
  periodStart: string,
  periodEnd: string,
  empFrom: string,
  empTo: string | null,
): number {
  let paid = 0;
  for (const day of days) {
    if (day.workDate < periodStart || day.workDate > periodEnd) continue;
    if (day.workDate < empFrom) continue;
    if (empTo !== null && day.workDate > empTo) continue;
    if (day.workDate < segment.effectiveFrom) continue;
    if (segment.effectiveTo !== null && day.workDate >= segment.effectiveTo) continue;
    paid += day.presentUnits + day.paidLeaveUnits + day.holidayUnits;
  }
  return paid;
}
