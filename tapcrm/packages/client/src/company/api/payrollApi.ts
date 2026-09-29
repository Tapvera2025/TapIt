import { identityRequest } from '../../identity/api/authApi.js';
import { peopleRead, peopleMutation } from './client.js';

export interface SlipSummary {
  id: string;
  periodStart: string;
  revisionNumber: number;
  grossPaise: string;
  netPaise: string;
}

export interface SlipDetail {
  id: string;
  status: string;
  periodStart: string;
  grossPaise: string;
  netPaise: string;
  deductionsPaise: string;
}

export interface SlipDocument {
  id: string;
  objectKey: string;
  sha256: string;
  renderedAt: string;
}

export interface CycleStatus {
  currentSlip: { id: string; periodStart: string; status: string; revisionNumber: number } | null;
}

export type RunStatus = 'draft' | 'computing' | 'review' | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface RunSummary {
  id: string;
  periodStart: string;
  status: RunStatus;
}

export interface RunDetail {
  id: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  configId: string;
  status: RunStatus;
  populationFingerprint: string | null;
  configFingerprint: string | null;
  inputsChanged: boolean;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface RunEmployee {
  id: string;
  runId: string;
  userId: string;
  employmentWindowStart: string;
  employmentWindowEnd: string | null;
  inputs: Record<string, unknown>;
  inputsFingerprint: string;
  status: 'pending' | 'computing' | 'computed' | 'failed';
  computedAt: string | null;
}

export interface RunBlocker {
  userId: string;
  workDate: string | null;
  kind: string;
  sourceId: string | null;
}

export interface RunDrift {
  id: string;
  userId: string;
  kind: string;
  resolvedAt: string | null;
}

export function getPayrollCycle(): Promise<CycleStatus> {
  return peopleRead<CycleStatus>('/api/payroll/cycle', { staleMs: 30_000 });
}

export function listMySlips(): Promise<{ slips: SlipSummary[] }> {
  return peopleRead<{ slips: SlipSummary[] }>('/api/payroll/payslips/mine', { staleMs: 60_000 });
}

export function getSlipDetail(id: string): Promise<SlipDetail> {
  return identityRequest<SlipDetail>(`/api/payroll/payslips/${encodeURIComponent(id)}`);
}

export function getSlipDocument(id: string): Promise<SlipDocument | null> {
  return identityRequest<SlipDocument | null>(`/api/payroll/payslips/${encodeURIComponent(id)}/document`);
}

export function listRuns(): Promise<{ runs: RunSummary[] }> {
  return peopleRead<{ runs: RunSummary[] }>('/api/payroll/runs', { staleMs: 15_000 });
}

export function createRun(periodStart: string): Promise<{ runId: string; blockers: RunBlocker[] }> {
  return peopleMutation(
    '/api/payroll/runs',
    { method: 'POST', body: JSON.stringify({ periodStart }) },
    ['/api/payroll/runs'],
  );
}

export function getRunDetail(id: string): Promise<RunDetail | null> {
  return identityRequest<RunDetail | null>(`/api/payroll/runs/${encodeURIComponent(id)}`);
}

export function getRunEmployees(id: string): Promise<{ employees: RunEmployee[] }> {
  return identityRequest<{ employees: RunEmployee[] }>(`/api/payroll/runs/${encodeURIComponent(id)}/employees`);
}

export function patchRun(id: string, action: 'start' | 'cancel'): Promise<{ ok: boolean }> {
  return peopleMutation(
    `/api/payroll/runs/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ action }) },
    ['/api/payroll/runs'],
  );
}

export function publishRun(id: string): Promise<{ status: 'published'; publishedAt: string } | { status: 'blocked'; blockers: RunBlocker[] }> {
  return peopleMutation(
    `/api/payroll/runs/${encodeURIComponent(id)}/publish`,
    { method: 'POST', body: '{}' },
    ['/api/payroll/runs'],
  );
}

export function listRunDrifts(id: string): Promise<{ drifts: RunDrift[] }> {
  return identityRequest<{ drifts: RunDrift[] }>(`/api/payroll/runs/${encodeURIComponent(id)}/drifts`);
}

export function remediateDrift(runId: string, driftId: string): Promise<{ ok: boolean }> {
  return peopleMutation(
    `/api/payroll/runs/${encodeURIComponent(runId)}/drifts/${encodeURIComponent(driftId)}/remediate`,
    { method: 'POST', body: '{}' },
    [`/api/payroll/runs/${encodeURIComponent(runId)}/drifts`],
  );
}

export function reviseSlip(id: string, reason: string): Promise<{ slipId: string }> {
  return peopleMutation(
    `/api/payroll/payslips/${encodeURIComponent(id)}/revise`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    ['/api/payroll/payslips/mine'],
  );
}
