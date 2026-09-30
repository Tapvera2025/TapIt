import { identityRequest } from '../../identity/api/authApi.js';

export type TerritoryDimension = 'geography' | 'industry' | 'product' | 'lead_source';
export type TerritoryStatus = 'active' | 'inactive';
export interface TerritoryRule { id: string; dimension: TerritoryDimension; value: string; }
export interface Territory {
  id: string; organizationId: string; name: string; description: string | null;
  salesTeamId: string; salesTeamName: string; departmentId: string; status: TerritoryStatus;
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; rules: TerritoryRule[];
}
export interface TerritoryInput {
  name: string; description?: string | null; salesTeamId: string;
  status: TerritoryStatus; rules: Array<{ dimension: TerritoryDimension; value: string }>;
}
export type TerritoryUpdateInput = Omit<Partial<TerritoryInput>, 'salesTeamId'>;
export type AssignmentStrategy = 'fewest_open_leads' | 'round_robin' | 'manual_queue';
export interface RoutingConfiguration { enabled: boolean; assignmentStrategy: AssignmentStrategy; updatedBy: string; updatedAt: string; }
export interface TerritoryCoverage {
  territoryId: string; territoryName: string; territoryStatus: TerritoryStatus;
  salesTeamId: string; salesTeamName: string; salesPools: Array<{ id: string; name: string }>;
  rules: Array<{ dimension: TerritoryDimension; value: string }>;
  routingEnabled: boolean; assignmentStrategy: AssignmentStrategy;
  metrics: { activeAgents: null; punchedInAgents: null; openLeads: null; unroutedLeads: null };
}
export interface TerritoryReportingMetric { territoryId: string; territoryName: string; salesTeamId: string; salesTeamName: string; leadCount: null; conversionCount: null; conversionRate: null; revenue: null; }
export interface TerritoryReporting { filters: { territoryId: string | null; salesTeamId: string | null; salesPoolId: string | null; source: string | null; from: string | null; to: string | null }; territories: TerritoryReportingMetric[]; sources: Array<{ source: string; leadCount: null; conversionCount: null; conversionRate: null; revenue: null }>; }
export function getTerritories(): Promise<Territory[]> { return identityRequest('/api/territories'); }
export function getTerritory(id: string): Promise<Territory> { return identityRequest(`/api/territories/${id}`); }
export function createTerritory(input: TerritoryInput): Promise<Territory> { return identityRequest('/api/territories', { method: 'POST', body: JSON.stringify(input) }); }
export function updateTerritory(id: string, input: TerritoryUpdateInput): Promise<Territory> { return identityRequest(`/api/territories/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export function updateTerritoryStatus(id: string, status: TerritoryStatus): Promise<Territory> { return identityRequest(`/api/territories/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }); }
export function getRoutingConfiguration(): Promise<RoutingConfiguration> { return identityRequest('/api/territories/routing'); }
export function updateRoutingConfiguration(input: Pick<RoutingConfiguration, 'enabled' | 'assignmentStrategy'>): Promise<RoutingConfiguration> { return identityRequest('/api/territories/routing', { method: 'PUT', body: JSON.stringify(input) }); }
export function getTerritoryCoverage(): Promise<TerritoryCoverage[]> { return identityRequest('/api/territories/coverage'); }
export function reassignTerritory(id: string, salesTeamId: string): Promise<Territory> { return identityRequest(`/api/territories/${id}/reassign`, { method: 'POST', body: JSON.stringify({ salesTeamId, confirm: true }) }); }
export function getTerritoryReporting(): Promise<TerritoryReporting> { return identityRequest('/api/territories/reporting'); }
