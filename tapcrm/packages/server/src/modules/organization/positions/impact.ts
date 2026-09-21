import type { PositionRecord } from './repository.js';
import type { PositionImpactRecord, PositionParentChange } from './repository.js';
import { REGISTRY, isAction } from '@tapcrm/contracts';

/** The policy fields relevant to an unsaved policy-set comparison. */
export interface PositionPolicyForImpact {
  readonly action: string;
  readonly allowed: boolean;
  readonly scope: string;
  readonly fields: readonly string[] | null;
  readonly constraints: readonly string[] | null;
}

export interface PositionPolicyScopeChange {
  readonly action: string;
  readonly from: string;
  readonly to: string;
}

export interface PositionPolicyChange {
  readonly action: string;
  readonly allowedChanged: boolean;
  readonly fieldsChanged: boolean;
  readonly constraintsChanged: boolean;
}

export interface PositionPolicyImpactPreview {
  readonly preview: true;
  readonly position: Pick<PositionRecord, 'id' | 'name' | 'departmentId'>;
  readonly holderCount: number;
  readonly capabilitiesAdded: readonly string[];
  readonly capabilitiesRemoved: readonly string[];
  readonly scopeChanges: readonly PositionPolicyScopeChange[];
  readonly policyChanges: readonly PositionPolicyChange[];
  readonly affectedPositionIds: readonly string[];
  readonly affectedHolderIds: readonly string[];
  /** A policy edit does not alter reporting; hierarchy previews retain theirs below. */
  readonly reportingRelationships: readonly PositionImpactRecord['reportingRelationships'][number][];
  readonly requiresConfirmation: boolean;
}

export interface PositionScopeDescriptionContext {
  readonly departmentName: string | null;
  /** Null means the editor cannot safely see a complete population count. */
  readonly teamMemberCount: number | null;
  readonly poolMemberCount: number | null;
  readonly departmentMemberCount: number | null;
  readonly organizationPeopleCount: number | null;
  readonly multipleHolderContexts: boolean;
}

export interface PositionPolicyScopeDescription {
  readonly action: string;
  readonly allowed: boolean;
  readonly scope: string;
  readonly description: string;
  readonly peopleCount: number | null;
}

export interface PositionPolicyScopeDescriptions {
  readonly current: readonly PositionPolicyScopeDescription[];
  readonly proposed: readonly PositionPolicyScopeDescription[];
}

/** Reserved for Step 4 hierarchy impact previews. */
export interface PositionImpactPreview {
  readonly positionId: string;
  readonly affectedPositionIds: readonly string[];
  readonly affectedHolderIds: readonly string[];
  readonly positionParentChanges: readonly PositionParentChange[];
  readonly requiresConfirmation: true;
}

export function emptyPositionImpact(position: PositionRecord): PositionImpactPreview {
  return {
    positionId: position.id,
    affectedPositionIds: [],
    affectedHolderIds: [],
    positionParentChanges: [],
    requiresConfirmation: true,
  };
}

export function toPositionImpactPreview(
  position: PositionRecord,
  impact: PositionImpactRecord,
): PositionImpactPreview & {
  reportingRelationships: PositionImpactRecord['reportingRelationships'];
} {
  return {
    positionId: position.id,
    affectedPositionIds: impact.positionIds,
    affectedHolderIds: impact.holderIds,
    positionParentChanges: [],
    reportingRelationships: impact.reportingRelationships,
    requiresConfirmation: true,
  };
}

export function toPositionInsertionImpactPreview(
  position: {
    code: string;
    name: string;
    departmentId: string;
    organizationalLevel: number;
    parentPositionId: string | null;
  },
  impact: {
    positionIds: readonly string[];
    holderIds: readonly string[];
    parentChanges: readonly PositionParentChange[];
    reportingRelationships: readonly PositionImpactRecord['reportingRelationships'][number][];
  },
) {
  return {
    preview: true as const,
    operation: 'insert' as const,
    position,
    affectedPositionIds: [...impact.positionIds],
    affectedHolderIds: [...impact.holderIds],
    positionParentChanges: [...impact.parentChanges],
    reportingRelationships: impact.reportingRelationships.map((relationship) => ({
      userId: relationship.userId,
      currentReportsTo: relationship.reportsTo,
      proposedReportsTo: relationship.reportsTo,
      changed: false,
    })),
    requiresConfirmation: true as const,
  };
}

/**
 * OR-7 policy diff. This is deliberately pure: callers can calculate a preview
 * from the persisted set and an unsaved candidate without writing an audit row,
 * outbox event, or policy record. Position-policy identity is the action, as
 * enforced by ux_position_policy and the request validator.
 */
export function toPositionPolicyImpactPreview(
  position: PositionRecord,
  current: readonly PositionPolicyForImpact[],
  proposed: readonly PositionPolicyForImpact[],
  holderIds: readonly string[],
): PositionPolicyImpactPreview {
  const currentByAction = new Map(current.map((policy) => [policy.action, policy]));
  const proposedByAction = new Map(proposed.map((policy) => [policy.action, policy]));
  const actions = [
    ...new Set([...currentByAction.keys(), ...proposedByAction.keys()]),
  ].sort();
  const capabilitiesAdded: string[] = [];
  const capabilitiesRemoved: string[] = [];
  const scopeChanges: PositionPolicyScopeChange[] = [];
  const policyChanges: PositionPolicyChange[] = [];

  for (const action of actions) {
    const before = currentByAction.get(action);
    const after = proposedByAction.get(action);
    const wasAllowed = before?.allowed === true;
    const isAllowed = after?.allowed === true;

    if (!wasAllowed && isAllowed) capabilitiesAdded.push(action);
    if (wasAllowed && !isAllowed) capabilitiesRemoved.push(action);

    if (
      wasAllowed &&
      isAllowed &&
      before !== undefined &&
      after !== undefined &&
      before.scope !== after.scope
    ) {
      scopeChanges.push({ action, from: before.scope, to: after.scope });
    }

    const allowedChanged = before?.allowed !== after?.allowed;
    const fieldsChanged = !sameValues(before?.fields ?? null, after?.fields ?? null);
    const constraintsChanged = !sameValues(
      before?.constraints ?? null,
      after?.constraints ?? null,
    );
    if (
      allowedChanged ||
      fieldsChanged ||
      constraintsChanged ||
      (wasAllowed && isAllowed && before?.scope !== after?.scope)
    ) {
      policyChanges.push({ action, allowedChanged, fieldsChanged, constraintsChanged });
    }
  }

  return {
    preview: true,
    position: {
      id: position.id,
      name: position.name,
      departmentId: position.departmentId,
    },
    holderCount: holderIds.length,
    capabilitiesAdded,
    capabilitiesRemoved,
    scopeChanges,
    policyChanges,
    affectedPositionIds: [position.id],
    affectedHolderIds: [...holderIds],
    reportingRelationships: [],
    requiresConfirmation: policyChanges.length > 0,
  };
}

function sameValues(
  left: readonly string[] | null,
  right: readonly string[] | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (left.length !== right.length) return false;
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

/** OR-8's explanation layer. It does not make or alter authorization decisions. */
export function describePositionPolicyScope(
  position: PositionRecord,
  policy: PositionPolicyForImpact,
  context: PositionScopeDescriptionContext,
): PositionPolicyScopeDescription {
  if (!policy.allowed)
    return described(policy, 'This permission is currently disabled.', null);

  const subject = position.name;
  const verb = actionVerb(policy.action);
  const resource = actionResource(policy.action);
  switch (policy.scope) {
    case 'own':
      return described(policy, `${subject} can ${verb} their own ${resource}.`, null);
    case 'participant':
      return described(
        policy,
        `${subject} can ${verb} ${resource} where they are a participant.`,
        null,
      );
    case 'team':
      return described(
        policy,
        peopleScopeSentence(
          subject,
          verb,
          resource,
          'team',
          context.teamMemberCount,
          context.multipleHolderContexts,
        ),
        context.teamMemberCount,
      );
    case 'pool':
      return described(
        policy,
        peopleScopeSentence(
          subject,
          verb,
          resource,
          'pool',
          context.poolMemberCount,
          context.multipleHolderContexts,
        ),
        context.poolMemberCount,
      );
    case 'department': {
      const department =
        context.departmentName === null
          ? 'their department'
          : `the ${context.departmentName} department`;
      const people = peoplePhrase(context.departmentMemberCount, department);
      return described(
        policy,
        `${subject} can ${verb} ${resource} belonging to ${people}.`,
        context.departmentMemberCount,
      );
    }
    case 'all-people':
      return described(
        policy,
        `${subject} can ${verb} ${resource} for ${peoplePhrase(context.organizationPeopleCount, 'the organization', 'across')}.`,
        context.organizationPeopleCount,
      );
    default:
      return described(policy, 'This permission uses an unsupported scope.', null);
  }
}

export function describePositionPolicyScopes(
  position: PositionRecord,
  current: readonly PositionPolicyForImpact[],
  proposed: readonly PositionPolicyForImpact[],
  context: PositionScopeDescriptionContext,
): PositionPolicyScopeDescriptions {
  const describe = (policies: readonly PositionPolicyForImpact[]) =>
    [...policies]
      .sort((left, right) => left.action.localeCompare(right.action))
      .map((policy) => describePositionPolicyScope(position, policy, context));
  return { current: describe(current), proposed: describe(proposed) };
}

function described(
  policy: PositionPolicyForImpact,
  description: string,
  peopleCount: number | null,
): PositionPolicyScopeDescription {
  return {
    action: policy.action,
    allowed: policy.allowed,
    scope: policy.scope,
    description,
    peopleCount,
  };
}

function peopleScopeSentence(
  subject: string,
  verb: string,
  resource: string,
  scope: 'team' | 'pool',
  count: number | null,
  multiple: boolean,
): string {
  const label = multiple ? `${scope}s` : scope;
  if (count === null)
    return `${subject} can ${verb} ${resource} belonging to people in their ${label}.`;
  if (count === 0)
    return `${subject} can ${verb} ${resource} belonging to no active people in their ${label}.`;
  return `${subject} can ${verb} ${resource} belonging to ${count} ${pluralize('person', count)} in their ${label}.`;
}

function peoplePhrase(count: number | null, place: string, prefix = 'in'): string {
  if (count === null) return `people ${prefix} ${place}`;
  if (count === 0) return `no active people ${prefix} ${place}`;
  return `${count} ${pluralize('person', count)} ${prefix} ${place}`;
}

function actionVerb(action: string): string {
  return isAction(action) ? action.split(':')[1]!.replace(/-/g, ' ') : 'use';
}

function actionResource(action: string): string {
  if (!isAction(action)) return 'records';
  const namespace = action.split(':')[0] ?? 'record';
  return pluralizeWords(REGISTRY[action].resource ?? namespace);
}

function pluralizeWords(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase();
  if (words.endsWith('y') && !/[aeiou]y$/.test(words)) return `${words.slice(0, -1)}ies`;
  return words.endsWith('s') ? words : `${words}s`;
}

function pluralize(word: string, count: number): string {
  if (word === 'person') return count === 1 ? 'person' : 'people';
  return count === 1 ? word : `${word}s`;
}
