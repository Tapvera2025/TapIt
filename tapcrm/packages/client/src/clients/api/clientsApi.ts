import { identityRequest } from '../../identity/api/authApi.js';

export const CLIENT_REGIONS = ['global', 'us', 'ca', 'au', 'in'] as const;
export type ClientRegion = (typeof CLIENT_REGIONS)[number];
export const CLIENT_REGION_LABELS: Record<ClientRegion, string> = {
  global: 'Global', us: 'US', ca: 'CA', au: 'AU', in: 'IN',
};

export interface Client {
  id: string;
  organizationId: string;
  clientName: string;
  businessName: string;
  email: string;
  region: ClientRegion;
  currency: string;
  timezone: string;
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  hasActiveLogin: boolean;
  loginUserId: string | null;
}

export interface PaginatedClients {
  items: Client[];
  total: number; // count
  page: number; // index
  pageSize: number; // limit
  totalPages: number; // count
}

export interface CreateClientInput {
  clientName: string;
  businessName: string;
  email: string;
  password: string;
  region: ClientRegion;
}

export function getClients(query: { search?: string; status?: 'active' | 'inactive' | 'all'; page?: number } = {}): Promise<PaginatedClients> {
  const params = new URLSearchParams();
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.status) params.set('status', query.status);
  if (query.page) params.set('page', String(query.page));
  const suffix = params.toString();
  return identityRequest(`/api/clients${suffix ? `?${suffix}` : ''}`);
}

export function getClient(id: string): Promise<Client> {
  return identityRequest(`/api/clients/${encodeURIComponent(id)}`);
}

export function createClient(input: CreateClientInput): Promise<Client> {
  return identityRequest('/api/clients', { method: 'POST', body: JSON.stringify(input) });
}

export function updateClient(id: string, input: Partial<Pick<Client, 'clientName' | 'businessName' | 'region' | 'status'>>): Promise<Client> {
  return identityRequest(`/api/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function setClientCredentials(id: string, password: string): Promise<{ hasActiveLogin: boolean }> {
  return identityRequest(`/api/clients/${encodeURIComponent(id)}/credentials`, { method: 'POST', body: JSON.stringify({ password }) });
}

export function revokeClientCredentials(id: string): Promise<{ hasActiveLogin: boolean }> {
  return identityRequest(`/api/clients/${encodeURIComponent(id)}/credentials`, { method: 'DELETE' });
}

/** A cryptographically random password, generated in the browser — never derived from the client's name/email. */
export function generateStrongPassword(length = 16): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => charset[value % charset.length]).join('');
}
