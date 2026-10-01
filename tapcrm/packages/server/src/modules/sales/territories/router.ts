import type { Territory } from './types.js';
import { isInboundLead, matchTerritories } from './matcher.js';
import type { AssignmentStrategy, LeadRoutingAttributes, RoutingCandidate, RoutingDecision } from './routing-types.js';

export interface RoutingInput extends LeadRoutingAttributes {
  territories: readonly Territory[];
  candidates: readonly RoutingCandidate[];
  assignmentStrategy?: AssignmentStrategy;
  routingEnabled?: boolean;
}

function eligible(candidates: readonly RoutingCandidate[], teamId: string | null): RoutingCandidate[] {
  return candidates.filter((candidate) => candidate.active && candidate.punchedIn && (teamId === null || candidate.salesTeamId === teamId));
}

export function chooseFewestOpenLeads(candidates: readonly RoutingCandidate[]): RoutingCandidate | null {
  return [...candidates].sort((a, b) => a.openLeadCount - b.openLeadCount || a.agentId.localeCompare(b.agentId))[0] ?? null;
}

/** Pure routing decision. Lead persistence remains the Leads module's responsibility. */
export function routeLead(input: RoutingInput): RoutingDecision {
  if (!isInboundLead(input)) return { type: 'SKIPPED', reason: 'AGENT_CREATED', ownerId: input.createdByUserId ?? '' };
  if (input.routingEnabled === false) return { type: 'UNROUTED', territoryId: null, salesTeamId: null, reason: 'NO_TERRITORY_MATCH' };

  const territory = input.territories.length === 0 ? null : matchTerritories(input.territories, input);
  const teamId = territory?.salesTeamId ?? null;
  const candidates = eligible(input.candidates, teamId);
  const selected = (input.assignmentStrategy ?? 'fewest_open_leads') === 'fewest_open_leads' ? chooseFewestOpenLeads(candidates) : null;

  if (!selected) return { type: 'UNROUTED', territoryId: territory?.id ?? null, salesTeamId: teamId, reason: territory ? 'NO_AVAILABLE_AGENT' : input.territories.length === 0 ? 'NO_AVAILABLE_AGENT' : 'NO_TERRITORY_MATCH' };
  return { type: 'ASSIGNED', territoryId: territory?.id ?? null, salesTeamId: selected.salesTeamId, agentId: selected.agentId, assignmentStrategy: input.assignmentStrategy ?? 'fewest_open_leads', reason: 'ASSIGNED' };
}
