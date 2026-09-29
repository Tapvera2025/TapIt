import type { Territory, TerritoryDimension } from './types.js';

export type AssignmentStrategy = 'fewest_open_leads' | 'round_robin' | 'manual_queue';
export type RoutingReason = 'AGENT_CREATED' | 'NO_TERRITORY_MATCH' | 'NO_AVAILABLE_AGENT';

export interface LeadRoutingAttributes {
  createdByUserId?: string | null;
  /** Existing Lead implementations may provide either source or origin. */
  source?: string | null;
  origin?: string | null;
  geography?: string | null;
  industry?: string | null;
  product?: string | null;
}

export interface RoutingCandidate {
  agentId: string;
  salesTeamId: string;
  openLeadCount: number;
  active: boolean;
  punchedIn: boolean;
}

export interface RoutingDecisionAssigned {
  type: 'ASSIGNED';
  territoryId: string | null;
  salesTeamId: string | null;
  agentId: string;
  assignmentStrategy: AssignmentStrategy;
  reason: 'ASSIGNED';
}

export interface RoutingDecisionUnrouted {
  type: 'UNROUTED';
  territoryId: string | null;
  salesTeamId: string | null;
  reason: Exclude<RoutingReason, 'AGENT_CREATED'>;
}

export interface RoutingDecisionSkipped {
  type: 'SKIPPED';
  reason: 'AGENT_CREATED';
  ownerId: string;
}

export type RoutingDecision = RoutingDecisionAssigned | RoutingDecisionUnrouted | RoutingDecisionSkipped;

export interface RoutingConfiguration {
  enabled: boolean;
  assignmentStrategy: AssignmentStrategy;
  updatedBy: string;
  updatedAt: Date;
}

export type RoutingTerritory = Pick<Territory, 'id' | 'status' | 'salesTeamId' | 'rules'>;

export type RuleDimension = TerritoryDimension;

export interface TerritoryCoverage {
  territoryId: string;
  territoryName: string;
  territoryStatus: 'active' | 'inactive';
  salesTeamId: string;
  salesTeamName: string;
  salesPools: Array<{ id: string; name: string }>;
  rules: Array<{ dimension: TerritoryDimension; value: string }>;
  routingEnabled: boolean;
  assignmentStrategy: AssignmentStrategy;
  metrics: {
    activeAgents: null;
    punchedInAgents: null;
    openLeads: null;
    unroutedLeads: null;
  };
}
