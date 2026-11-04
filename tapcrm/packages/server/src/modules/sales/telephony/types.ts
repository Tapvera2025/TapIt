/**
 * Call Analytics — JustCall and Aircall.
 *
 * A company connects its calling platform with API keys. The sync copies the
 * platform's users and calls into the CRM; platform users are matched to CRM
 * employees by email so each call lands on an employee's and a team's view.
 */

export const TELEPHONY_PROVIDERS = ['justcall', 'aircall'] as const;
export type TelephonyProvider = (typeof TELEPHONY_PROVIDERS)[number];

export type ConnectionStatus = 'active' | 'paused' | 'error' | 'disconnected';
export type SyncStatus = 'running' | 'succeeded' | 'partial' | 'failed';
export type SyncTrigger = 'connect' | 'manual' | 'schedule';
export type CallDirection = 'inbound' | 'outbound';
export const CALL_OUTCOMES = [
  'answered',
  'missed',
  'voicemail',
  'abandoned',
  'unanswered',
  'busy',
  'failed',
  'other',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export type MatchMethod = 'none' | 'email' | 'manual' | 'ignored';

export interface JustCallCredentials {
  readonly provider: 'justcall';
  readonly apiKey: string;
  readonly apiSecret: string;
}

export interface AircallCredentials {
  readonly provider: 'aircall';
  readonly apiId: string;
  readonly apiToken: string;
}

export type ProviderCredentials = JustCallCredentials | AircallCredentials;

/* ------------------------------------------------------------------ *
 * What a provider adapter returns, already normalized.
 * ------------------------------------------------------------------ */

export interface NormalizedAgent {
  readonly externalId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly role: string | null;
  readonly extension: string | null;
  readonly timeZone: string | null;
  readonly phoneNumbers: readonly string[];
  readonly groups: readonly string[];
  readonly isActive: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface CallAgentRef {
  readonly externalId: string;
  readonly name: string | null;
  readonly email: string | null;
}

export interface NormalizedCall {
  readonly externalId: string;
  readonly agent: CallAgentRef | null;
  readonly direction: CallDirection;
  readonly outcome: CallOutcome;
  readonly providerStatus: string | null;
  readonly missedReason: string | null;
  readonly startedAt: Date;
  readonly answeredAt: Date | null;
  readonly endedAt: Date | null;
  readonly durationSeconds: number;
  readonly talkSeconds: number;
  readonly ringSeconds: number | null;
  readonly holdSeconds: number | null;
  readonly queueWaitSeconds: number | null;
  readonly wrapUpSeconds: number | null;
  readonly contactNumber: string | null;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly businessNumber: string | null;
  readonly businessNumberName: string | null;
  readonly hasRecording: boolean;
  readonly hasVoicemail: boolean;
  readonly notes: string | null;
  readonly disposition: string | null;
  readonly tags: readonly string[];
  readonly rating: number | null;
  readonly aiSummary: string | null;
  readonly aiSentiment: string | null;
  readonly aiScore: number | null;
  readonly providerLink: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface CallWindow {
  readonly from: Date;
  readonly to: Date;
}

/* ------------------------------------------------------------------ *
 * API shapes (camelCase on the wire, ISO 8601 UTC times).
 * ------------------------------------------------------------------ */

export interface TelephonyConnectionView {
  readonly id: string;
  readonly provider: TelephonyProvider;
  readonly label: string;
  readonly status: ConnectionStatus;
  readonly credentialsHint: string | null;
  readonly backfillDays: number;
  readonly syncedThrough: Date | null;
  readonly lastSyncStatus: SyncStatus | null;
  readonly lastSyncStartedAt: Date | null;
  readonly lastSyncFinishedAt: Date | null;
  readonly lastSyncError: string | null;
  readonly lastVerifiedAt: Date | null;
  readonly agentCount: number;
  readonly matchedAgentCount: number;
  readonly unmatchedAgentCount: number;
  readonly callCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What every viewer may know about a connection: no keys, no hint. */
export interface TelephonyConnectionSummary {
  readonly id: string;
  readonly provider: TelephonyProvider;
  readonly label: string;
  readonly status: ConnectionStatus;
  readonly lastSyncFinishedAt: Date | null;
  readonly lastSyncStatus: SyncStatus | null;
}

export interface TelephonySyncRunView {
  readonly id: string;
  readonly connectionId: string;
  readonly trigger: SyncTrigger;
  readonly status: SyncStatus;
  readonly windowFrom: Date | null;
  readonly windowTo: Date | null;
  readonly agentsSeen: number;
  readonly agentsMatched: number;
  readonly callsSeen: number;
  readonly callsCreated: number;
  readonly callsUpdated: number;
  readonly apiRequests: number;
  readonly error: string | null;
  readonly requestedByName: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
}

export interface TelephonyAgentView {
  readonly id: string;
  readonly connectionId: string;
  readonly provider: TelephonyProvider;
  readonly externalId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly role: string | null;
  readonly extension: string | null;
  readonly phoneNumbers: readonly string[];
  readonly groups: readonly string[];
  readonly isActive: boolean;
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly employeeEmail: string | null;
  readonly matchMethod: MatchMethod;
  readonly matchedAt: Date | null;
  readonly callCount: number;
  readonly lastCallAt: Date | null;
  readonly lastSeenAt: Date;
}

export interface EmployeeOption {
  readonly id: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly teamName: string | null;
  readonly departmentName: string | null;
}

export interface TelephonyCallListItem {
  readonly id: string;
  readonly provider: TelephonyProvider;
  readonly direction: CallDirection;
  readonly outcome: CallOutcome;
  readonly startedAt: Date;
  readonly durationSeconds: number;
  readonly talkSeconds: number;
  readonly contactNumber: string | null;
  readonly contactName: string | null;
  readonly businessNumber: string | null;
  readonly businessNumberName: string | null;
  readonly agentName: string | null;
  readonly agentEmail: string | null;
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly teamName: string | null;
  readonly hasRecording: boolean;
  readonly hasVoicemail: boolean;
  readonly disposition: string | null;
  readonly tags: readonly string[];
  readonly aiSentiment: string | null;
}

export interface TelephonyCallDetail extends TelephonyCallListItem {
  readonly externalId: string;
  readonly providerStatus: string | null;
  readonly missedReason: string | null;
  readonly answeredAt: Date | null;
  readonly endedAt: Date | null;
  readonly ringSeconds: number | null;
  readonly holdSeconds: number | null;
  readonly queueWaitSeconds: number | null;
  readonly wrapUpSeconds: number | null;
  readonly contactEmail: string | null;
  readonly notes: string | null;
  readonly rating: number | null;
  readonly aiSummary: string | null;
  readonly aiScore: number | null;
  readonly providerLink: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly connectionLabel: string;
  readonly lastSyncedAt: Date;
}

export interface PaginatedCalls {
  readonly items: readonly TelephonyCallListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export interface CallTotals {
  readonly totalCalls: number;
  readonly inbound: number;
  readonly outbound: number;
  readonly answered: number;
  readonly missedInbound: number;
  readonly voicemail: number;
  readonly unansweredOutbound: number;
  readonly talkSeconds: number;
  readonly avgTalkSeconds: number;
  readonly uniqueContacts: number;
  readonly lastCallAt: Date | null;
}

export interface DailyCallPoint {
  readonly day: string;
  readonly inbound: number;
  readonly outbound: number;
  readonly answered: number;
  readonly missed: number;
  readonly talkSeconds: number;
}

export interface HourlyCallPoint {
  readonly hour: number;
  readonly calls: number;
}

export interface EmployeeCallStats {
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly teamName: string | null;
  readonly totalCalls: number;
  readonly inbound: number;
  readonly outbound: number;
  readonly answered: number;
  readonly missedInbound: number;
  readonly talkSeconds: number;
  readonly avgTalkSeconds: number;
  readonly lastCallAt: Date | null;
}

export interface OutcomeCount {
  readonly outcome: CallOutcome;
  readonly calls: number;
}

export interface TelephonyOverview {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly totals: CallTotals;
  readonly daily: readonly DailyCallPoint[];
  readonly hourly: readonly HourlyCallPoint[];
  readonly outcomes: readonly OutcomeCount[];
  readonly employees: readonly EmployeeCallStats[];
  readonly connections: readonly TelephonyConnectionSummary[];
}

export interface VisibleEmployee {
  readonly id: string;
  readonly fullName: string;
  readonly teamId: string | null;
  readonly teamName: string | null;
}

export interface VisibleTeam {
  readonly id: string;
  readonly name: string;
}

export interface TelephonyPeople {
  readonly employees: readonly VisibleEmployee[];
  readonly teams: readonly VisibleTeam[];
}
