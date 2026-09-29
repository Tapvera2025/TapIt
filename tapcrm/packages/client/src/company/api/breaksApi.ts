import { identityRequest } from '../../identity/api/authApi.js';
import { peopleRead, peopleMutation } from './client.js';

export interface BreakAllowance {
  workDate: string;
  noPolicy: boolean;
  policy: {
    upperTotalMinutes: number | null;
    upperSingleMinutes: number | null;
    lowerTotalMinutes: number | null;
    graceMinutes: number;
    warningPercent: number;
  } | null;
  usage: { totalMinutes: number; longestMinutes: number; count: number };
  remaining: { totalMinutes: number | null; singleMinutes: number | null };
  warning: { totalState: string; singleState: string };
}

export interface BreakPrompt {
  breachId: string;
  workDate: string;
  ruleCondition: string;
  measuredTotalMinutes: number;
  measuredSingleMinutes: number;
  measuredCount: number;
}

export interface BreachListItem {
  id: string;
  userId: string;
  workDate: string;
  status: string;
  matchedRuleId: string | null;
  occurrenceNumber: number | null;
  autoApplied: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  waivedBy: string | null;
  waivedAt: string | null;
  waiverReason: string | null;
  explanation: string | null;
  createdAt: string;
}

export function getBreakAllowance(signal?: AbortSignal): Promise<BreakAllowance> {
  return identityRequest<BreakAllowance>('/api/breaks/allowance/me', { signal: signal ?? null });
}

export function getBreakPrompts(signal?: AbortSignal): Promise<BreakPrompt[]> {
  return identityRequest<BreakPrompt[]>('/api/breaks/prompts/me', { signal: signal ?? null });
}

export function submitBreachExplanation(breachId: string, explanation: string): Promise<{ id: string; status: string }> {
  return peopleMutation(
    `/api/breaks/breaches/${encodeURIComponent(breachId)}/explanation`,
    { method: 'POST', body: JSON.stringify({ explanation }) },
    ['/api/breaks/breaches'],
  );
}

export function listBreaches(params?: {
  userId?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}): Promise<BreachListItem[]> {
  const q = new URLSearchParams();
  if (params?.userId) q.set('userId', params.userId);
  if (params?.status) q.set('status', params.status);
  if (params?.fromDate) q.set('fromDate', params.fromDate);
  if (params?.toDate) q.set('toDate', params.toDate);
  if (params?.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return peopleRead<BreachListItem[]>(`/api/breaks/breaches${qs ? `?${qs}` : ''}`, { staleMs: 15_000 });
}

export function confirmBreach(id: string, reason?: string): Promise<{ id: string; status: string }> {
  return peopleMutation(
    `/api/breaks/breaches/${encodeURIComponent(id)}/confirm`,
    { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) },
    ['/api/breaks/breaches'],
  );
}

export function waiveBreach(id: string, reason: string): Promise<{ id: string; status: string }> {
  return peopleMutation(
    `/api/breaks/breaches/${encodeURIComponent(id)}/waive`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    ['/api/breaks/breaches'],
  );
}

// ── Break Policy Management ────────────────────────────────────────────────────

export interface BreakPolicyRow {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
}

export function listBreakPolicies(): Promise<BreakPolicyRow[]> {
  return peopleRead<BreakPolicyRow[]>('/api/breaks/policies', { staleMs: 60_000 });
}

export function createBreakPolicy(body: {
  name: string;
  effectiveFrom: string;
  upperTotalMinutes?: number | null;
  upperSingleMinutes?: number | null;
  lowerTotalMinutes?: number | null;
  lowerEnforced?: boolean;
  graceMinutes?: number;
  warningPercent?: number;
  countsTowardWorkHours?: boolean;
  rules?: Array<{
    ordinal: number;
    condition: string;
    occurrenceWindow: string;
    occurrenceCount?: number;
    consequence: string;
    minutes?: number | null;
    autoApply?: boolean;
  }>;
}): Promise<{ policyId: string; versionId: string }> {
  return peopleMutation(
    '/api/breaks/policies',
    { method: 'POST', body: JSON.stringify({ rules: [], ...body }) },
    ['/api/breaks/policies'],
  );
}

export function assignBreakPolicy(policyId: string, body: {
  effectiveFrom: string;
  effectiveTo?: string | null;
  priority?: number;
  departmentId?: string | null;
  positionId?: string | null;
  shiftId?: string | null;
  teamId?: string | null;
  userId?: string | null;
}): Promise<{ assignmentId: string }> {
  return peopleMutation(
    `/api/breaks/policies/${encodeURIComponent(policyId)}/assign`,
    { method: 'POST', body: JSON.stringify(body) },
    ['/api/breaks/policies'],
  );
}
