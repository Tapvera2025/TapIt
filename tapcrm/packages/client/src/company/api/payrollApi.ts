import { identityRequest } from '../../identity/api/authApi.js';
import { peopleRead, peopleMutation } from './client.js';

export interface SlipSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  revisionNumber: number;
  grossPaise: string;
  deductionsPaise: string;
  netPaise: string;
  publishedAt: string | null;
}

export interface SlipLine {
  code: string;
  label: string;
  kind: 'earning' | 'deduction' | 'employer-contribution';
  amountPaise: string;
  sortOrder: number;
}

export interface SlipDetail {
  id: string;
  userId: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  revisionNumber: number;
  grossPaise: string;
  netPaise: string;
  deductionsPaise: string;
  employerContributionPaise: string | null;
  publishedAt: string | null;
  fullName: string;
  employeeCode: string | null;
  departmentName: string | null;
  positionName: string | null;
  organizationName: string | null;
  lines: SlipLine[];
}

export interface SlipDocument {
  id: string;
  objectKey: string;
  sha256: string;
  renderedAt: string;
}

export interface CycleStatus {
  currentSlip: { id: string; periodStart: string; status: string; revisionNumber: number; netPaise: string } | null;
}

export type RunStatus = 'draft' | 'computing' | 'review' | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface RunSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: RunStatus;
  inputsChanged: boolean;
  createdAt: string;
  publishedAt: string | null;
  employeeCount: number;
  computedCount: number;
  failedCount: number;
  pendingCount: number;
}

export type RunDetail = RunSummary & { configId: string };

export interface ReviewEmployee {
  userId: string;
  fullName: string;
  employeeCode: string | null;
  departmentName: string | null;
  status: 'pending' | 'computing' | 'computed' | 'failed';
  computedAt: string | null;
  employmentWindowStart: string;
  employmentWindowEnd: string | null;
  hasSalaryStructure: boolean;
  payslipId: string | null;
  payslipStatus: string | null;
  grossPaise: string | null;
  deductionsPaise: string | null;
  netPaise: string | null;
  paidDayCount: number | null;
  periodDayCount: number | null;
  lines: SlipLine[];
}

export interface RunBlocker {
  userId: string | null;
  fullName?: string | null;
  workDate: string | null;
  kind: string;
  sourceId: string | null;
}

export interface RunWarning {
  userId: string;
  fullName: string;
  kind: 'no-salary-structure' | 'no-leaving-date';
}

export interface RunDrift {
  id: string;
  userId: string;
  fullName: string;
  kind: string;
  sourceType: string | null;
  resolvedAt: string | null;
}

export interface CreateRunResult {
  runId: string;
  employeeCount: number;
  blockers: RunBlocker[];
  warnings: RunWarning[];
}

export type PublishResult =
  | { status: 'published'; publishedAt: string; payslips: number }
  | { status: 'blocked'; blockers: RunBlocker[] };

export type StructureLineKind = 'earning' | 'deduction' | 'employer-contribution';

export interface StructureLine {
  id: string;
  code: string;
  label: string;
  kind: StructureLineKind;
  amount: string;
  prorated: boolean;
  statutoryTags: string[];
  sortOrder: number;
}

export interface SalaryStructure {
  id: string;
  userId: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  usedByPublishedPayslip: boolean;
  lines: StructureLine[];
}

export interface StructureSummary {
  userId: string;
  fullName: string;
  employeeCode: string | null;
  departmentName: string | null;
  accountStatus: string;
  structureId: string | null;
  currency: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  earnings: string | null;
  deductions: string | null;
  nextEffectiveFrom: string | null;
}

export interface SaveStructureLine {
  code: string;
  label: string;
  kind: StructureLineKind;
  /** Rupees as a decimal string ("45000.50"): money never travels as a JavaScript number (PG-5). */
  amount: string;
  prorated: boolean;
}

export interface SaveStructureInput {
  currency: string;
  effectiveFrom: string;
  lines: SaveStructureLine[];
  replacesStructureId?: string | null;
  reason?: string | null;
}

export interface PayrollConfig {
  id: string;
  effectiveFrom: string;
  settings: Record<string, unknown>;
  acceptedBy: string;
  acceptedByName: string | null;
  acceptedAt: string;
  caHrApproval: string;
  status: 'active' | 'voided' | 'superseded';
  supersedesConfigId: string | null;
}

export type PayrollInputKind = 'adjustment' | 'advance-recovery' | 'arrear' | 'bonus' | 'tds' | 'break-deduction';
export type PayrollInputState = 'pending' | 'in-run' | 'published' | 'unpaid' | 'revoked';

export interface PayrollInput {
  id: string;
  userId: string;
  fullName: string;
  employeeCode: string | null;
  periodStart: string;
  kind: PayrollInputKind;
  amount: string;
  label: string;
  reason: string | null;
  breakBreachId: string | null;
  createdAt: string;
  createdByName: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  state: PayrollInputState;
}

const RUNS = '/api/payroll/runs';

export function getPayrollCycle(): Promise<CycleStatus> {
  return peopleRead<CycleStatus>('/api/payroll/cycle', { staleMs: 30_000 });
}

export function listMySlips(): Promise<{ slips: SlipSummary[] }> {
  return peopleRead<{ slips: SlipSummary[] }>('/api/payroll/payslips/mine', { staleMs: 60_000 });
}

export function getSlipDetail(id: string): Promise<SlipDetail | null> {
  return identityRequest<SlipDetail | null>(`/api/payroll/payslips/${encodeURIComponent(id)}`);
}

export function getSlipDocument(id: string): Promise<SlipDocument | null> {
  return identityRequest<SlipDocument | null>(`/api/payroll/payslips/${encodeURIComponent(id)}/document`);
}

export function listRuns(): Promise<{ runs: RunSummary[] }> {
  return identityRequest<{ runs: RunSummary[] }>(RUNS);
}

export function createRun(periodStart: string): Promise<CreateRunResult> {
  return peopleMutation(RUNS, { method: 'POST', body: JSON.stringify({ periodStart }) }, [RUNS, '/api/payroll/inputs']);
}

export function getRunDetail(id: string): Promise<RunDetail> {
  return identityRequest<RunDetail>(`${RUNS}/${encodeURIComponent(id)}`);
}

export function getRunEmployees(id: string): Promise<{ employees: ReviewEmployee[] }> {
  return identityRequest<{ employees: ReviewEmployee[] }>(`${RUNS}/${encodeURIComponent(id)}/employees`);
}

export function patchRun(
  id: string,
  action: 'start' | 'cancel' | 'recalculate',
): Promise<{ status: RunStatus; queued?: number; recalculated?: number }> {
  return peopleMutation(
    `${RUNS}/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ action }) },
    [RUNS, '/api/payroll/inputs'],
  );
}

export function publishRun(id: string): Promise<PublishResult> {
  return peopleMutation(
    `${RUNS}/${encodeURIComponent(id)}/publish`,
    { method: 'POST', body: '{}' },
    [RUNS, '/api/payroll/inputs', '/api/payroll/payslips', '/api/payroll/cycle'],
  );
}

export function listRunDrifts(id: string): Promise<{ drifts: RunDrift[] }> {
  return identityRequest<{ drifts: RunDrift[] }>(`${RUNS}/${encodeURIComponent(id)}/drifts`);
}

export function remediateDrift(runId: string, driftId: string): Promise<{ ok: boolean }> {
  return peopleMutation(
    `${RUNS}/${encodeURIComponent(runId)}/drifts/${encodeURIComponent(driftId)}/remediate`,
    { method: 'POST', body: '{}' },
    [`${RUNS}/${encodeURIComponent(runId)}/drifts`],
  );
}

export function reviseSlip(
  id: string,
  reason: string,
): Promise<{ revisionSlipId: string; revisionNumber: number; previousNetPaise: string; netPaise: string }> {
  return peopleMutation(
    `/api/payroll/payslips/${encodeURIComponent(id)}/revise`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    [RUNS, '/api/payroll/inputs', '/api/payroll/payslips', '/api/payroll/cycle'],
  );
}

export function listStructureSummaries(onDate?: string): Promise<{ onDate: string; employees: StructureSummary[] }> {
  const query = onDate ? `?onDate=${encodeURIComponent(onDate)}` : '';
  return identityRequest(`/api/payroll/structures${query}`);
}

export function listStructureHistory(userId: string): Promise<{ structures: SalaryStructure[] }> {
  return identityRequest(`/api/payroll/structures?userId=${encodeURIComponent(userId)}`);
}

export function saveStructure(
  userId: string,
  input: SaveStructureInput,
): Promise<{ id: string; closedStructureId: string | null; voidedStructureId: string | null }> {
  return peopleMutation(
    `/api/payroll/structures/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        ...input,
        lines: input.lines.map((line, index) => ({ ...line, statutoryTags: [], sortOrder: (index + 1) * 10 })),
      }),
    },
    ['/api/payroll/structures'],
  );
}

export function listConfigs(): Promise<{ configs: PayrollConfig[] }> {
  return identityRequest('/api/payroll/config');
}

export function acceptConfig(input: {
  effectiveFrom: string;
  caHrApproval: string;
  settings: Record<string, unknown>;
  supersedesConfigId?: string | null;
}): Promise<{ id: string; supersededConfigId: string | null }> {
  return peopleMutation('/api/payroll/config', { method: 'PUT', body: JSON.stringify(input) }, ['/api/payroll/config']);
}

export function listInputs(periodStart: string): Promise<{ inputs: PayrollInput[] }> {
  return identityRequest(`/api/payroll/inputs?periodStart=${encodeURIComponent(periodStart)}`);
}

export function addInput(input: {
  userId: string;
  periodStart: string;
  kind: Exclude<PayrollInputKind, 'break-deduction'>;
  /** Rupees as a decimal string. */
  amount: string;
  label: string;
  reason: string;
}): Promise<{ id: string }> {
  return peopleMutation('/api/payroll/inputs', { method: 'POST', body: JSON.stringify(input) }, ['/api/payroll/inputs']);
}

export function revokeInput(id: string, reason: string): Promise<{ ok: boolean }> {
  return peopleMutation(
    `/api/payroll/inputs/${encodeURIComponent(id)}/revoke`,
    { method: 'PATCH', body: JSON.stringify({ reason }) },
    ['/api/payroll/inputs'],
  );
}

// ── Formatting shared by the payroll screens ─────────────────────────────

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** "₹47,000" from integer paise ("4700000"). */
export function formatPaise(paise: string | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  const value = Number(BigInt(paise) / 100n);
  return inr.format(value);
}

/** "₹30,000" from a rupee decimal string ("30000.0000"). */
export function formatRupees(amount: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return inr.format(Number(amount));
}

export function formatMonth(periodStart: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${periodStart}T12:00:00Z`),
  );
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date.slice(0, 10)}T12:00:00Z`),
  );
}

/** First day of the month before `today` (YYYY-MM-DD), the month payroll usually runs for. */
export function previousMonthStart(today = new Date()): string {
  const year = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
  const month = today.getMonth() === 0 ? 12 : today.getMonth();
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function currentMonthStart(today = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
}

export const INPUT_KIND_LABELS: Record<PayrollInputKind, string> = {
  bonus: 'Bonus',
  arrear: 'Arrear',
  adjustment: 'Adjustment (addition)',
  'advance-recovery': 'Advance recovery',
  tds: 'TDS (income tax)',
  'break-deduction': 'Break deduction',
};

export const BLOCKER_LABELS: Record<string, string> = {
  'open-day': 'Attendance day still open',
  'recalculation-failed': 'Attendance calculation failed',
  'not-evaluated': 'Breaks not yet evaluated',
  'stale-evaluation': 'Breaks need re-evaluation',
  'pending-correction': 'Correction request pending',
  'open-review-item': 'Attendance review item open',
  'break:pending-consequence': 'Break breach awaiting review',
  'break:pending-explanation': 'Break explanation awaiting',
  'inputs-changed': 'Pay inputs changed since calculation',
  'joined-after-freeze': 'Joined after the run was created',
  'left-after-freeze': 'Left before the run was created',
  'settings-changed': 'Payroll settings changed',
};
