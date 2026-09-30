export const CLIENT_REGIONS = ['global', 'us', 'ca', 'au', 'in'] as const;
export type ClientRegion = (typeof CLIENT_REGIONS)[number];

/**
 * Region → currency/timezone. A product decision, not a lookup service: five
 * fixed regions, five fixed answers. `global` falls back to the organization's
 * own configured currency/timezone (set at project-creation time, not stored
 * here, since it is the ONE region without a single obvious answer).
 */
export const REGION_CURRENCY: Readonly<Record<ClientRegion, string>> = {
  global: 'USD',
  us: 'USD',
  ca: 'CAD',
  au: 'AUD',
  in: 'INR',
};

export const REGION_TIMEZONE: Readonly<Record<ClientRegion, string>> = {
  global: 'UTC',
  us: 'America/New_York',
  ca: 'America/Toronto',
  au: 'Australia/Sydney',
  in: 'Asia/Kolkata',
};

export type ClientStatus = 'active' | 'inactive';

export interface Client {
  readonly id: string;
  readonly organizationId: string;
  readonly clientName: string;
  readonly businessName: string;
  readonly email: string;
  readonly region: ClientRegion;
  readonly currency: string;
  readonly timezone: string;
  readonly status: ClientStatus;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Whether a login (app_user, account_type='client') exists and is active. No client-portal UI reads it yet (Phase 5). */
  readonly hasActiveLogin: boolean;
}

export interface ClientListQuery {
  readonly search?: string | undefined;
  readonly status?: ClientStatus | 'all' | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
}

export interface PaginatedClients {
  readonly items: readonly Client[];
  readonly total: number; // count
  readonly page: number; // index
  readonly pageSize: number; // limit
  readonly totalPages: number; // count
}

export interface CreateClientInput {
  readonly clientName: string;
  readonly businessName: string;
  readonly email: string;
  readonly password: string;
  readonly region: ClientRegion;
}

export interface UpdateClientInput {
  readonly clientName?: string | undefined;
  readonly businessName?: string | undefined;
  readonly region?: ClientRegion | undefined;
  readonly status?: ClientStatus | undefined;
}

/** Referenced by the projects module when creating a project (business name autofill, currency snapshot). */
export interface ClientSummary {
  readonly id: string;
  readonly clientName: string;
  readonly businessName: string;
  readonly currency: string;
  readonly status: ClientStatus;
}
