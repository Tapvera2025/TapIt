import type { Territory } from './types.js';
import type { LeadRoutingAttributes, RoutingTerritory } from './routing-types.js';

const INBOUND_SOURCES = new Set(['website', 'website_form', 'social', 'social_message', 'ad_landing_page', 'referral']);
const OUTBOUND_SOURCES = new Set(['cold_call', 'email', 'direct_email', 'linkedin', 'personal_contact', 'manual', 'outbound']);

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim().toLocaleLowerCase();
  return result ? result : null;
}

/**
 * Lead-domain boundary used by routing. A creator always wins over routing;
 * explicit inbound origin/source is otherwise used when available.
 */
export function isInboundLead(lead: LeadRoutingAttributes): boolean {
  if (lead.createdByUserId) return false;
  const origin = normalized(lead.origin);
  if (origin === 'outbound' || origin === 'manual' || origin === 'agent_created') return false;
  if (origin === 'inbound') return true;
  const source = normalized(lead.source);
  if (source && OUTBOUND_SOURCES.has(source)) return false;
  return source ? INBOUND_SOURCES.has(source) : false;
}

export function routingOwner(lead: LeadRoutingAttributes): RoutingDecisionOwner {
  return isInboundLead(lead) ? { route: true } : { route: false, ownerId: lead.createdByUserId ?? '' };
}

export type RoutingDecisionOwner = { route: true } | { route: false; ownerId: string };

function matches(territory: RoutingTerritory, lead: LeadRoutingAttributes): boolean {
  if (territory.status !== 'active') return false;
  return territory.rules.every((rule) => normalized(lead[rule.dimension === 'lead_source' ? 'source' : rule.dimension]) === normalized(rule.value));
}

/**
 * Rules within one territory are ANDed. More rules means greater specificity;
 * equal-specificity ties use the stable territory id, never database order.
 */
export function matchTerritories(territories: readonly Territory[], lead: LeadRoutingAttributes): Territory | null {
  return territories.filter((territory) => matches(territory, lead)).sort((a, b) => b.rules.length - a.rules.length || a.id.localeCompare(b.id))[0] ?? null;
}
