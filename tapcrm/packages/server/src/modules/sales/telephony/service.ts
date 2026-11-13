import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';
import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import type { DateOnly } from '@tapcrm/contracts';
import { addDays, daysBetween, isTimeZone, localDateOf, toDateOnly } from '../../../platform/time.js';
import {
  assertCredentialsKeyConfigured,
  credentialsHint,
  credentialsKeyConfigured,
  decryptCredentials,
  encryptCredentials,
} from './crypto.js';
import {
  ProviderError,
  TelephonyNoRecordingError,
  TelephonyNotEligibleError,
  TelephonyNotFoundError,
  TelephonyValidationError,
} from './errors.js';
import { requestSync } from './jobs.js';
import { createTelephonyClient, PROVIDER_LABEL } from './providers/index.js';
import {
  callWhere,
  findAgentView,
  findCallDetail,
  findCallForPlayback,
  findConnectionRow,
  findConnectionRowByProvider,
  findConnectionView,
  findEmployee,
  insertAudit,
  insertConnection,
  listAgentViews,
  listCallRows,
  listConnectionSummaries,
  listConnectionViews,
  listEmployeeOptions,
  listSyncRuns,
  listVisibleEmployees,
  markDisconnected,
  matchAgentsByEmail,
  newConnectionId,
  organizationTimeZone,
  recordVerification,
  replaceConnectionCredentials,
  resetEmailMatches,
  selectDaily,
  selectEmployees,
  selectHourly,
  selectOutcomes,
  selectTotals,
  setAgentMapping,
  updateConnectionSettings,
  type CallFilter,
} from './repository.js';
import type {
  DailyCallPoint,
  EmployeeOption,
  PaginatedCalls,
  ProviderCredentials,
  TelephonyAgentView,
  TelephonyCallDetail,
  TelephonyConnectionView,
  TelephonyOverview,
  TelephonyPeople,
  TelephonyProvider,
  TelephonySyncRunView,
  VisibleTeam,
} from './types.js';
import type {
  AgentListQuery,
  AgentMappingInput,
  CallListQuery,
  CreateConnectionInput,
  OverviewQuery,
  UpdateConnectionInput,
} from './validators.js';

/* ==================================================================== *
 * Connections (telephony:manage)
 * ==================================================================== */

export interface ConnectionsPayload {
  /** False until the server has TELEPHONY_CREDENTIALS_KEY: keys cannot be stored yet. */
  readonly keyConfigured: boolean;
  readonly connections: readonly TelephonyConnectionView[];
}

export async function listConnections(ctx: RequestContext): Promise<ConnectionsPayload> {
  return { keyConfigured: credentialsKeyConfigured(), connections: await listConnectionViews(ctx) };
}

async function requireConnectionView(ctx: RequestContext, id: string): Promise<TelephonyConnectionView> {
  const view = await findConnectionView(ctx, id);
  if (!view) throw new TelephonyNotFoundError('Call integration');
  return view;
}

/** Calls the platform with the key before anything is saved. */
async function verifyCredentials(credentials: ProviderCredentials): Promise<void> {
  await createTelephonyClient(credentials).verify();
}

function defaultLabel(provider: TelephonyProvider): string {
  return PROVIDER_LABEL[provider];
}

export async function createConnection(ctx: RequestContext, input: CreateConnectionInput): Promise<TelephonyConnectionView> {
  const credentials = input.credentials;
  const provider = credentials.provider;
  const existing = await findConnectionRowByProvider(ctx, provider);
  if (existing && existing.status !== 'disconnected') {
    throw new TelephonyNotEligibleError(
      `${PROVIDER_LABEL[provider]} is already connected. Use "Replace key" on that connection instead.`,
      'connectionDisconnected',
      existing.status,
    );
  }
  // Fail on a missing server key before asking the platform anything.
  assertCredentialsKeyConfigured();
  await verifyCredentials(credentials);

  const id = existing?.id ?? (await newConnectionId(ctx));
  const owner = { organizationId: ctx.organizationId, connectionId: id, provider };
  const encrypted = encryptCredentials(credentials, owner);
  const hint = credentialsHint(credentials);
  const label = input.label ?? defaultLabel(provider);

  await db.transaction(ctx, async (tx) => {
    if (existing) {
      await replaceConnectionCredentials(tx, ctx, id, {
        credentialsEncrypted: encrypted,
        credentialsHint: hint,
        label,
        backfillDays: input.backfillDays,
      });
    } else {
      await insertConnection(tx, ctx, {
        id,
        provider,
        label,
        credentialsEncrypted: encrypted,
        credentialsHint: hint,
        backfillDays: input.backfillDays,
      });
    }
    await insertAudit(tx, ctx, existing ? 'telephony.connection.reconnected' : 'telephony.connection.connected', 'telephonyConnection', id, null, {
      provider,
      label,
      backfillDays: input.backfillDays,
    });
  });
  await requestSync(ctx, id, 'connect');
  return requireConnectionView(ctx, id);
}

export async function updateConnection(
  ctx: RequestContext,
  id: string,
  input: UpdateConnectionInput,
): Promise<TelephonyConnectionView> {
  const row = await findConnectionRow(ctx, id);
  if (!row) throw new TelephonyNotFoundError('Call integration');
  if (row.status === 'disconnected' && !input.credentials) {
    throw new TelephonyNotEligibleError('This connection is disconnected. Enter an API key to reconnect it.', 'credentials', row.status);
  }
  if (input.credentials && input.credentials.provider !== row.provider) {
    throw new TelephonyValidationError(`These are ${PROVIDER_LABEL[input.credentials.provider]} keys, but this is the ${PROVIDER_LABEL[row.provider]} connection.`);
  }

  let replaced = false;
  if (input.credentials) {
    await verifyCredentials(input.credentials);
    const encrypted = encryptCredentials(input.credentials, { organizationId: ctx.organizationId, connectionId: id, provider: row.provider });
    const hint = credentialsHint(input.credentials);
    await db.transaction(ctx, async (tx) => {
      await replaceConnectionCredentials(tx, ctx, id, {
        credentialsEncrypted: encrypted,
        credentialsHint: hint,
        label: input.label,
        backfillDays: input.backfillDays,
      });
      if (input.status === 'paused') await updateConnectionSettings(tx, ctx, id, { status: 'paused' });
      await insertAudit(tx, ctx, 'telephony.connection.key-replaced', 'telephonyConnection', id, { status: row.status }, {
        label: input.label ?? row.label,
        backfillDays: input.backfillDays ?? row.backfillDays,
      });
    });
    replaced = true;
  } else {
    await db.transaction(ctx, async (tx) => {
      await updateConnectionSettings(tx, ctx, id, { label: input.label, backfillDays: input.backfillDays, status: input.status });
      await insertAudit(tx, ctx, 'telephony.connection.updated', 'telephonyConnection', id, {
        label: row.label,
        backfillDays: row.backfillDays,
        status: row.status,
      }, {
        label: input.label ?? row.label,
        backfillDays: input.backfillDays ?? row.backfillDays,
        status: input.status ?? row.status,
      });
    });
  }

  const resumed = input.status === 'active' && row.status === 'paused';
  if ((replaced && input.status !== 'paused') || resumed) await requestSync(ctx, id, 'manual');
  return requireConnectionView(ctx, id);
}

export interface ConnectionTestResult {
  readonly ok: boolean;
  readonly message: string;
  readonly connection: TelephonyConnectionView;
}

export async function testConnection(ctx: RequestContext, id: string): Promise<ConnectionTestResult> {
  const row = await findConnectionRow(ctx, id);
  if (!row) throw new TelephonyNotFoundError('Call integration');
  if (!row.credentialsEncrypted) {
    throw new TelephonyNotEligibleError('This connection is disconnected. Enter an API key to reconnect it.', 'credentials', row.status);
  }
  const label = PROVIDER_LABEL[row.provider];
  try {
    const credentials = decryptCredentials(row.credentialsEncrypted, { organizationId: ctx.organizationId, connectionId: id, provider: row.provider });
    await verifyCredentials(credentials);
    await recordVerification(ctx, id, { ok: true });
    return { ok: true, message: `${label} accepted the API key.`, connection: await requireConnectionView(ctx, id) };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    await recordVerification(ctx, id, { ok: false, rejected: error.kind === 'rejected', message: error.message });
    return { ok: false, message: error.message, connection: await requireConnectionView(ctx, id) };
  }
}

export async function syncConnectionNow(
  ctx: RequestContext,
  id: string,
): Promise<{ status: 'queued' | 'started'; connection: TelephonyConnectionView }> {
  const row = await findConnectionRow(ctx, id);
  if (!row) throw new TelephonyNotFoundError('Call integration');
  if (row.status === 'paused') throw new TelephonyNotEligibleError('This connection is paused. Resume it to sync.', 'status', row.status);
  if (row.status === 'disconnected') {
    throw new TelephonyNotEligibleError('This connection is disconnected. Enter an API key to reconnect it.', 'status', row.status);
  }
  const status = await requestSync(ctx, id, 'manual');
  return { status, connection: await requireConnectionView(ctx, id) };
}

export async function disconnectConnection(ctx: RequestContext, id: string): Promise<TelephonyConnectionView> {
  const row = await findConnectionRow(ctx, id);
  if (!row) throw new TelephonyNotFoundError('Call integration');
  if (row.status !== 'disconnected') {
    await db.transaction(ctx, async (tx) => {
      await markDisconnected(tx, ctx, id);
      await insertAudit(tx, ctx, 'telephony.connection.disconnected', 'telephonyConnection', id, { status: row.status }, { status: 'disconnected' });
    });
  }
  return requireConnectionView(ctx, id);
}

export async function listConnectionRuns(ctx: RequestContext, id: string, limit: number): Promise<TelephonySyncRunView[]> {
  const row = await findConnectionRow(ctx, id);
  if (!row) throw new TelephonyNotFoundError('Call integration');
  return listSyncRuns(ctx, id, limit);
}

/* ==================================================================== *
 * Platform users ↔ employees (telephony:manage)
 * ==================================================================== */

export async function listAgents(ctx: RequestContext, query: AgentListQuery): Promise<TelephonyAgentView[]> {
  return listAgentViews(ctx, query);
}

export async function mapAgent(ctx: RequestContext, id: string, input: AgentMappingInput): Promise<TelephonyAgentView> {
  const agent = await findAgentView(ctx, id);
  if (!agent) throw new TelephonyNotFoundError('Platform user');
  let employeeName: string | null = null;
  if (input.mode === 'employee') {
    const employee = await findEmployee(ctx, input.employeeId);
    if (!employee) throw new TelephonyValidationError('Choose an employee of this company.');
    employeeName = employee.fullName;
  }
  await db.transaction(ctx, async (tx) => {
    if (input.mode === 'employee') await setAgentMapping(tx, ctx, id, { method: 'manual', employeeId: input.employeeId });
    else if (input.mode === 'ignore') await setAgentMapping(tx, ctx, id, { method: 'ignored', employeeId: null });
    else {
      await setAgentMapping(tx, ctx, id, { method: 'none', employeeId: null });
      await matchAgentsByEmail(tx, ctx.organizationId);
    }
    await insertAudit(tx, ctx, 'telephony.agent.mapped', 'telephonyAgent', id, {
      employeeId: agent.employeeId,
      matchMethod: agent.matchMethod,
    }, {
      mode: input.mode,
      employeeId: input.mode === 'employee' ? input.employeeId : null,
      employeeName,
    });
  });
  const updated = await findAgentView(ctx, id);
  if (!updated) throw new TelephonyNotFoundError('Platform user');
  return updated;
}

export async function rematchAgents(ctx: RequestContext): Promise<{ matched: number }> {
  const matched = await db.transaction(ctx, async (tx) => {
    await resetEmailMatches(tx, ctx.organizationId);
    return matchAgentsByEmail(tx, ctx.organizationId);
  });
  return { matched };
}

export async function employeeOptions(ctx: RequestContext): Promise<EmployeeOption[]> {
  return listEmployeeOptions(ctx);
}

/* ==================================================================== *
 * Analytics (telephony:view)
 * ==================================================================== */

const DEFAULT_RANGE_DAYS = 30;

/** From/to as the company's calendar days; defaults to the last 30 days. */
export function resolveRange(
  query: { from?: string | undefined; to?: string | undefined },
  timeZone: string,
  now: Date = new Date(),
): { from: DateOnly; to: DateOnly } {
  const today = localDateOf(now, timeZone);
  const to = query.to ? toDateOnly(query.to) : today;
  const from = query.from ? toDateOnly(query.from) : addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (daysBetween(from, to) < 0) throw new TelephonyValidationError('The start date must be on or before the end date.');
  return { from, to };
}

/** Every day in the range, so a quiet day shows as zero instead of disappearing. */
export function fillDays(from: DateOnly, to: DateOnly, points: readonly DailyCallPoint[]): DailyCallPoint[] {
  const byDay = new Map(points.map((point) => [point.day, point]));
  const days: DailyCallPoint[] = [];
  const span = Math.min(daysBetween(from, to), 400);
  for (let offset = 0; offset <= span; offset += 1) {
    const day = addDays(from, offset);
    days.push(byDay.get(day) ?? { day, inbound: 0, outbound: 0, answered: 0, missed: 0, talkSeconds: 0 });
  }
  return days;
}

async function companyTimeZone(ctx: RequestContext): Promise<string> {
  const zone = await organizationTimeZone(ctx);
  return isTimeZone(zone) ? zone : 'UTC';
}

export async function getOverview(ctx: RequestContext, query: OverviewQuery): Promise<TelephonyOverview> {
  const visibility = await visibilityFilter(ctx, 'telephony:view', 'telephonyCall');
  const timeZone = await companyTimeZone(ctx);
  const range = resolveRange(query, timeZone);
  const filter: CallFilter = {
    from: range.from,
    to: range.to,
    timeZone,
    employeeId: query.employeeId,
    teamId: query.teamId,
    provider: query.provider,
    direction: query.direction,
  };
  const where = callWhere(ctx.organizationId, visibility, filter);
  const [totals, daily, hourly, outcomes, employees, connections] = await Promise.all([
    selectTotals(ctx, where),
    selectDaily(ctx, where, timeZone),
    selectHourly(ctx, where, timeZone),
    selectOutcomes(ctx, where),
    selectEmployees(ctx, where),
    listConnectionSummaries(ctx),
  ]);
  return {
    from: range.from,
    to: range.to,
    timeZone,
    totals,
    daily: fillDays(range.from, range.to, daily),
    hourly,
    outcomes,
    employees,
    connections,
  };
}

export async function listCalls(ctx: RequestContext, query: CallListQuery): Promise<PaginatedCalls> {
  const visibility = await visibilityFilter(ctx, 'telephony:view', 'telephonyCall');
  const timeZone = await companyTimeZone(ctx);
  const range = resolveRange(query, timeZone);
  const where = callWhere(ctx.organizationId, visibility, {
    from: range.from,
    to: range.to,
    timeZone,
    employeeId: query.employeeId,
    teamId: query.teamId,
    provider: query.provider,
    direction: query.direction,
    outcome: query.outcome,
    search: query.search,
    unmatchedOnly: query.unmatched,
  });
  const { rows, total } = await listCallRows(ctx, where, query.page, query.pageSize);
  return { items: rows, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

export async function getCall(ctx: RequestContext, id: string): Promise<TelephonyCallDetail> {
  const call = await findCallDetail(ctx, id);
  if (!call) throw new TelephonyNotFoundError('Call');
  return call;
}

export async function listPeople(ctx: RequestContext): Promise<TelephonyPeople> {
  const visibility = await visibilityFilter(ctx, 'telephony:view', 'telephonyCall');
  const employees = await listVisibleEmployees(ctx, visibility);
  const teams = new Map<string, VisibleTeam>();
  for (const employee of employees) {
    if (employee.teamId && employee.teamName) teams.set(employee.teamId, { id: employee.teamId, name: employee.teamName });
  }
  return { employees, teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/**
 * Streams a call's recording (or voicemail) through the CRM. The platform's
 * link is fetched fresh with the company's key and never handed to the
 * browser, so playback is authorized here and audited as `telephony:listen`.
 */
export async function streamRecording(ctx: RequestContext, id: string, res: ExpressResponse): Promise<void> {
  const call = await findCallForPlayback(ctx, id);
  if (!call) throw new TelephonyNotFoundError('Call');
  if (!call.hasRecording && !call.hasVoicemail) throw new TelephonyNoRecordingError();
  const connection = await findConnectionRow(ctx, call.connectionId);
  if (!connection?.credentialsEncrypted) {
    throw new TelephonyNotEligibleError(
      `The ${PROVIDER_LABEL[call.provider]} connection is disconnected, so its recordings cannot be played.`,
      'connection',
      connection?.status ?? 'missing',
    );
  }
  const credentials = decryptCredentials(connection.credentialsEncrypted, {
    organizationId: ctx.organizationId,
    connectionId: connection.id,
    provider: connection.provider,
  });
  let upstream: Response;
  try {
    upstream = await createTelephonyClient(credentials).fetchRecording(call.externalId);
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'not-found') throw new TelephonyNoRecordingError(error.message);
    throw error;
  }
  if (!upstream.body) throw new TelephonyNoRecordingError();
  const type = upstream.headers.get('content-type') ?? '';
  res.status(200);
  res.setHeader('Content-Type', type.startsWith('audio/') || type === 'application/octet-stream' ? type : 'audio/mpeg');
  const length = upstream.headers.get('content-length');
  if (length && /^\d+$/.test(length)) res.setHeader('Content-Length', length);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="call-${id}.mp3"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  await pipeline(Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>), res);
}
