import { identityDownload, identityRequest } from '../../../identity/api/authApi.js';

/* Call Analytics — JustCall and Aircall. Mirrors server/modules/sales/telephony/types.ts. */

export type TelephonyProvider = 'justcall' | 'aircall';
export type ConnectionStatus = 'active' | 'paused' | 'error' | 'disconnected';
export type SyncStatus = 'running' | 'succeeded' | 'partial' | 'failed';
export type CallDirection = 'inbound' | 'outbound';
export type CallOutcome = 'answered' | 'missed' | 'voicemail' | 'abandoned' | 'unanswered' | 'busy' | 'failed' | 'other';
export type MatchMethod = 'none' | 'email' | 'manual' | 'ignored';

export interface TelephonyConnection {
  id: string;
  provider: TelephonyProvider;
  label: string;
  status: ConnectionStatus;
  credentialsHint: string | null;
  backfillDays: number;
  syncedThrough: string | null;
  lastSyncStatus: SyncStatus | null;
  lastSyncStartedAt: string | null;
  lastSyncFinishedAt: string | null;
  lastSyncError: string | null;
  lastVerifiedAt: string | null;
  agentCount: number;
  matchedAgentCount: number;
  unmatchedAgentCount: number;
  callCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionsPayload {
  keyConfigured: boolean;
  connections: TelephonyConnection[];
}

export interface ConnectionSummary {
  id: string;
  provider: TelephonyProvider;
  label: string;
  status: ConnectionStatus;
  lastSyncFinishedAt: string | null;
  lastSyncStatus: SyncStatus | null;
}

export interface SyncRun {
  id: string;
  connectionId: string;
  trigger: 'connect' | 'manual' | 'schedule';
  status: SyncStatus;
  windowFrom: string | null;
  windowTo: string | null;
  agentsSeen: number;
  agentsMatched: number;
  callsSeen: number;
  callsCreated: number;
  callsUpdated: number;
  apiRequests: number;
  error: string | null;
  requestedByName: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface TelephonyAgent {
  id: string;
  connectionId: string;
  provider: TelephonyProvider;
  externalId: string;
  name: string | null;
  email: string | null;
  role: string | null;
  extension: string | null;
  phoneNumbers: string[];
  groups: string[];
  isActive: boolean;
  employeeId: string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  matchMethod: MatchMethod;
  matchedAt: string | null;
  callCount: number;
  lastCallAt: string | null;
  lastSeenAt: string;
}

export interface EmployeeOption {
  id: string;
  fullName: string;
  email: string | null;
  teamName: string | null;
  departmentName: string | null;
}

export interface CallListItem {
  id: string;
  provider: TelephonyProvider;
  direction: CallDirection;
  outcome: CallOutcome;
  startedAt: string;
  durationSeconds: number;
  talkSeconds: number;
  contactNumber: string | null;
  contactName: string | null;
  businessNumber: string | null;
  businessNumberName: string | null;
  agentName: string | null;
  agentEmail: string | null;
  employeeId: string | null;
  employeeName: string | null;
  teamName: string | null;
  hasRecording: boolean;
  hasVoicemail: boolean;
  disposition: string | null;
  tags: string[];
  aiSentiment: string | null;
}

export interface CallDetail extends CallListItem {
  externalId: string;
  providerStatus: string | null;
  missedReason: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  ringSeconds: number | null;
  holdSeconds: number | null;
  queueWaitSeconds: number | null;
  wrapUpSeconds: number | null;
  contactEmail: string | null;
  notes: string | null;
  rating: number | null;
  aiSummary: string | null;
  aiScore: number | null;
  providerLink: string | null;
  metadata: Record<string, unknown>;
  connectionLabel: string;
  lastSyncedAt: string;
}

export interface CallPage {
  items: CallListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CallTotals {
  totalCalls: number;
  inbound: number;
  outbound: number;
  answered: number;
  missedInbound: number;
  voicemail: number;
  unansweredOutbound: number;
  talkSeconds: number;
  avgTalkSeconds: number;
  uniqueContacts: number;
  lastCallAt: string | null;
}

export interface DailyCallPoint {
  day: string;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  talkSeconds: number;
}

export interface EmployeeCallStats {
  employeeId: string | null;
  employeeName: string | null;
  teamName: string | null;
  totalCalls: number;
  inbound: number;
  outbound: number;
  answered: number;
  missedInbound: number;
  talkSeconds: number;
  avgTalkSeconds: number;
  lastCallAt: string | null;
}

export interface CallOverview {
  from: string;
  to: string;
  timeZone: string;
  totals: CallTotals;
  daily: DailyCallPoint[];
  hourly: Array<{ hour: number; calls: number }>;
  outcomes: Array<{ outcome: CallOutcome; calls: number }>;
  employees: EmployeeCallStats[];
  connections: ConnectionSummary[];
}

export interface CallPeople {
  employees: Array<{ id: string; fullName: string; teamId: string | null; teamName: string | null }>;
  teams: Array<{ id: string; name: string }>;
}

export interface CallFilters {
  from?: string | undefined;
  to?: string | undefined;
  employeeId?: string | undefined;
  teamId?: string | undefined;
  provider?: TelephonyProvider | undefined;
  direction?: CallDirection | undefined;
}

export interface CallLogFilters extends CallFilters {
  outcome?: CallOutcome | undefined;
  search?: string | undefined;
  unmatched?: boolean | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export type CredentialsInput =
  | { provider: 'justcall'; apiKey: string; apiSecret: string }
  | { provider: 'aircall'; apiId: string; apiToken: string };

function query(filters: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters) as Array<[string, unknown]>) {
    if (value === '' || value === false) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

const id = (value: string) => encodeURIComponent(value);

export function getCallOverview(filters: CallFilters): Promise<CallOverview> {
  return identityRequest(`/api/telephony/overview${query(filters)}`);
}

export function getCalls(filters: CallLogFilters): Promise<CallPage> {
  return identityRequest(`/api/telephony/calls${query(filters)}`);
}

export function getCall(callId: string): Promise<CallDetail> {
  return identityRequest(`/api/telephony/calls/${id(callId)}`);
}

/** The recording or voicemail audio, fetched with the session so playback is authorized. */
export function getCallRecording(callId: string): Promise<Blob> {
  return identityDownload(`/api/telephony/calls/${id(callId)}/recording`);
}

export function getCallPeople(): Promise<CallPeople> {
  return identityRequest('/api/telephony/employees');
}

export function getConnections(): Promise<ConnectionsPayload> {
  return identityRequest('/api/telephony/connections');
}

export function connectProvider(input: { label?: string | undefined; backfillDays: number; credentials: CredentialsInput }): Promise<TelephonyConnection> {
  return identityRequest('/api/telephony/connections', { method: 'POST', body: JSON.stringify(input) });
}

export function updateConnection(
  connectionId: string,
  input: { label?: string; backfillDays?: number; status?: 'active' | 'paused'; credentials?: CredentialsInput },
): Promise<TelephonyConnection> {
  return identityRequest(`/api/telephony/connections/${id(connectionId)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function testConnection(connectionId: string): Promise<{ ok: boolean; message: string; connection: TelephonyConnection }> {
  return identityRequest(`/api/telephony/connections/${id(connectionId)}/test`, { method: 'POST' });
}

export function syncConnection(connectionId: string): Promise<{ status: 'queued' | 'started'; connection: TelephonyConnection }> {
  return identityRequest(`/api/telephony/connections/${id(connectionId)}/sync`, { method: 'POST' });
}

export function disconnectProvider(connectionId: string): Promise<TelephonyConnection> {
  return identityRequest(`/api/telephony/connections/${id(connectionId)}/disconnect`, { method: 'POST' });
}

export function getSyncRuns(connectionId: string, limit = 10): Promise<SyncRun[]> {
  return identityRequest(`/api/telephony/connections/${id(connectionId)}/runs?limit=${limit}`);
}

export function getAgents(filter: { connectionId?: string; status?: 'all' | 'matched' | 'unmatched' | 'ignored' } = {}): Promise<TelephonyAgent[]> {
  return identityRequest(`/api/telephony/agents${query(filter)}`);
}

export function mapAgent(
  agentId: string,
  input: { mode: 'employee'; employeeId: string } | { mode: 'ignore' } | { mode: 'auto' },
): Promise<TelephonyAgent> {
  return identityRequest(`/api/telephony/agents/${id(agentId)}/employee`, { method: 'PUT', body: JSON.stringify(input) });
}

export function rematchAgents(): Promise<{ matched: number }> {
  return identityRequest('/api/telephony/agents/rematch', { method: 'POST' });
}

export function getEmployeeOptions(): Promise<EmployeeOption[]> {
  return identityRequest('/api/telephony/employee-options');
}
