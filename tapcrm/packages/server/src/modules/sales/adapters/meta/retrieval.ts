/**
 * Sales v1.1 — Meta Lead Ads Graph API client (R1 plan step 1.7).
 *
 * Pure helpers over an injected `fetcher`. The handler calling these
 * supplies the dependency so tests can run without hitting Facebook.
 *
 * `normalizeFieldData` maps the Graph "name/values" tuples onto the
 * canonical IntakeMappedFields shape. Field names on Meta forms are
 * stable across tenants, so this translation lives here and not on each
 * connector's config.
 */

import type { IntakeMappedFields } from '../../intake/types.js';

export interface GraphFieldDatum {
  readonly name: string;
  readonly values: readonly string[];
}

export interface GraphLeadResponse {
  readonly id: string;
  readonly created_time?: string;
  readonly field_data: readonly GraphFieldDatum[];
}

export interface GraphFormLead {
  readonly id: string;
  readonly created_time?: string;
}

export interface MetaFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type MetaFetcher = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<MetaFetchResponse>;

export class MetaReconnectRequiredError extends Error {
  constructor(public readonly connectorId: string, public readonly status: number) {
    super(`Meta Graph API returned ${status}; connector ${connectorId} must be reconnected`);
    this.name = 'MetaReconnectRequiredError';
  }
}

export class MetaFetchFailedError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Meta Graph API returned ${status}: ${body.slice(0, 200)}`);
    this.name = 'MetaFetchFailedError';
  }
}

export function graphLeadUrl(leadgenId: string, graphVersion: string): string {
  return `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(leadgenId)}?fields=field_data,created_time`;
}

export function graphFormListUrl(pageId: string, graphVersion: string): string {
  return `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name,leads{created_time}&limit=50`;
}

export async function fetchMetaLead(
  fetcher: MetaFetcher,
  pageAccessToken: string,
  leadgenId: string,
  graphVersion: string,
): Promise<GraphLeadResponse> {
  const response = await fetcher(graphLeadUrl(leadgenId, graphVersion), {
    headers: { Authorization: `Bearer ${pageAccessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new MetaReconnectRequiredError(leadgenId, response.status);
  }
  if (!response.ok) {
    throw new MetaFetchFailedError(response.status, await response.text());
  }
  const body = await response.json();
  if (!isGraphLeadResponse(body)) {
    throw new MetaFetchFailedError(response.status, 'Graph response did not match expected shape');
  }
  return body;
}

function isGraphLeadResponse(value: unknown): value is GraphLeadResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string') return false;
  if (!Array.isArray(record['field_data'])) return false;
  return (record['field_data'] as unknown[]).every(isGraphFieldDatum);
}

function isGraphFieldDatum(value: unknown): value is GraphFieldDatum {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['name'] === 'string' && Array.isArray(record['values']);
}

/**
 * Translate Meta's `field_data` tuples into the canonical
 * IntakeMappedFields shape. Unknown field names are preserved verbatim
 * so campaign managers can wire a new form field without a code change.
 *
 * The field-name set below reflects the "defaults" users see in the
 * Meta Form Builder; a tenant-specific override lives on the connector
 * `config.fieldMap` when a form uses non-default names.
 */
export function normalizeFieldData(
  fieldData: readonly GraphFieldDatum[],
  overrides: Readonly<Record<string, keyof IntakeMappedFields | string>> = {},
): IntakeMappedFields {
  const mapped: Record<string, unknown> = {};
  for (const entry of fieldData) {
    const value = entry.values[0];
    if (value === undefined || value === null || value === '') continue;
    const target = overrides[entry.name] ?? DEFAULT_FIELD_MAP[entry.name] ?? entry.name;
    mapped[target] = value;
  }
  return mapped;
}

const DEFAULT_FIELD_MAP: Readonly<Record<string, keyof IntakeMappedFields>> = {
  full_name: 'contactName',
  first_name: 'contactName',
  phone_number: 'phoneRaw',
  phone: 'phoneRaw',
  email: 'emailRaw',
  company_name: 'companyName',
  job_title: 'companyName',
  city: 'location',
  city_name: 'location',
  location: 'location',
  service_requested: 'serviceRequested',
  service: 'serviceRequested',
  budget: 'budgetBracket',
  timeline: 'timeline',
  message: 'message',
  language_preference: 'languagePreference',
};
