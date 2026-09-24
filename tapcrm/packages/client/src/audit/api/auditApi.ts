import { identityDownload, identityRequest } from '../../identity/api/authApi.js';

export interface AuditEntry {
  id: string;
  organizationId: string;
  stream: 'access' | 'activity';
  sequence: string;
  occurredAt: string;
  actorId: string | null;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string | null;
  beforeData: unknown;
  afterData: unknown;
  reason: string | null;
  sourceIp: string | null;
  requestId: string | null;
  hashVersion: number;
  prevHash: string | null;
  hash: string;
  legalHold: boolean;
}

export interface AuditQuery {
  stream?: 'access' | 'activity';
  actorId?: string;
  targetId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditIntegrityReport {
  organizationId: string;
  checkedAt: string;
  outcome: 'success' | 'failure';
  entriesChecked: number;
  errorCount: number;
  streams: Array<{
    stream: 'access' | 'activity';
    entriesChecked: number;
    failures: Array<{ stream: string; reason: string; sequence: string; occurredAt: string | null }>;
  }>; 
  retention?: {
    lastRunAt: string | null;
    lastOutcome: string | null;
    archivedRanges: number;
    archivedEntries: number;
  };
}

export interface LegalHold {
  id: string;
  organizationId: string;
  holdType: 'user' | 'client' | 'date-range';
  targetId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  reason: string;
  placedBy: string;
  placedAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
  status: 'active' | 'released';
}

export interface LegalHoldTarget {
  id: string;
  kind: 'user' | 'client';
  name: string;
  code: string | null;
}

function queryString(query: AuditQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : '';
}

export function getAuditEntries(query: AuditQuery = {}): Promise<{
  entries: AuditEntry[];
  nextCursor: string | null;
}> {
  return identityRequest(`/api/audit${queryString(query)}`);
}

export function downloadAuditExport(query: AuditQuery, format: 'csv' | 'json'): Promise<Blob> {
  const body = Object.fromEntries(Object.entries({ ...query, format }).filter(([, value]) => value !== undefined && value !== ''));
  return identityDownload('/api/audit/export', { method: 'POST', body: JSON.stringify(body) });
}

export function getAuditEntry(id: string): Promise<AuditEntry> {
  return identityRequest(`/api/audit/${encodeURIComponent(id)}`);
}

export function getAuditIntegrity(): Promise<AuditIntegrityReport | null> {
  return identityRequest('/api/audit/integrity');
}

export function getLegalHolds(status: 'active' | 'released' | 'all' = 'active'): Promise<{ holds: LegalHold[] }> {
  return identityRequest(`/api/audit/holds?status=${status}`);
}

export function getLegalHoldTargets(): Promise<{ targets: LegalHoldTarget[] }> {
  return identityRequest('/api/audit/hold-targets');
}

export function createLegalHold(input: {
  holdType: 'user' | 'client' | 'date-range';
  targetId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  reason: string;
}): Promise<LegalHold> {
  return identityRequest('/api/audit/holds', { method: 'POST', body: JSON.stringify(input) });
}

export function releaseLegalHold(id: string, reason?: string): Promise<LegalHold> {
  return identityRequest(`/api/audit/holds/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}
