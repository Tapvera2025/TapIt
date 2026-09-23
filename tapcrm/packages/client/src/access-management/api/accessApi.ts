import type { Action, Scope } from '@tapcrm/contracts';
import { identityRequest } from '../../identity/api/authApi.js';

export interface AccessPolicyRow {
  action: Action;
  module: string;
  description: string;
  screens: string[];
  allowed: boolean;
  scope: Scope | null;
  fields: string[] | null;
  constraints: string[] | null;
  source: 'position' | 'override' | 'super-admin' | 'none';
  locked: boolean;
  lockReason: string | null;
  override: {
    id: string;
    reason: string;
    grantedBy: string;
    grantedAt: string;
    expiresAt: string | null;
  } | null;
}

export interface AccessPerson {
  id: string;
  fullName: string;
  email: string | null;
  accountType: 'super-admin' | 'employee' | 'client' | 'service';
  position: { id: string; name: string | null } | null;
  department: { id: string; name: string | null } | null;
  team: { id: string; name: string | null } | null;
  reportsTo?: { id: string; name: string | null } | null;
}

export interface EffectiveAccessResponse {
  subject: AccessPerson;
  policies: AccessPolicyRow[];
  subordinateIds: string[];
  subordinates: AccessPerson[];
  reachableActions: Action[];
}

export interface CapabilityHolder {
  user: {
    id: string;
    fullName: string;
    email: string | null;
    accountType: 'employee' | 'super-admin';
  };
  organization: { id: string; code: string; name: string };
  position: { id: string; name: string | null } | null;
  source: 'position' | 'override' | 'super-admin';
  scope: Scope | null;
  fields: string[] | null;
  reason: string;
  override: {
    id: string;
    grantedBy: string;
    grantedAt: string;
    expiresAt: string | null;
  } | null;
}

export interface OverrideOverviewItem {
  id: string;
  user: { id: string; fullName: string; email: string | null };
  organization: { id: string; code: string; name: string };
  position: { id: string; name: string | null } | null;
  action: Action;
  allowed: boolean;
  scope: Scope;
  fields: string[] | null;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string | null;
  ageDays: number;
  reviewRequired: boolean;
  positionHolderCount: number;
  matchingOverrideCount: number;
  recommendPositionPolicy: boolean;
}

export interface DelegationOption {
  action: Action;
  scopes: Scope[];
  fields: string[] | null;
  canGrant: boolean;
  reason: string | null;
}

export interface RoleChangeRequest {
  id: string;
  subject: { id: string; fullName: string; email: string | null };
  fromPosition: { id: string; name: string | null } | null;
  toPosition: { id: string; name: string | null };
  requestedReportsTo: { id: string; name: string | null } | null;
  requestedTeam: { id: string; name: string | null } | null;
  requestedBy: { id: string; fullName: string };
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
}

export function getEffectiveAccess(userId: string): Promise<EffectiveAccessResponse> {
  return identityRequest(`/api/access/effective/${encodeURIComponent(userId)}`);
}

export function getCapabilityHolders(action: Action): Promise<{
  action: Action;
  holders: CapabilityHolder[];
}> {
  return identityRequest(`/api/access/who-can/${encodeURIComponent(action)}`);
}

export function getOverrideOverview(): Promise<{ overrides: OverrideOverviewItem[] }> {
  return identityRequest('/api/access/overrides');
}

export function getDelegationOptions(targetUserId: string): Promise<{
  targetUserId: string;
  options: DelegationOption[];
}> {
  return identityRequest(`/api/access/delegation-options/${encodeURIComponent(targetUserId)}`);
}

export function grantAccessOverride(input: {
  userId: string;
  action: Action;
  allowed: boolean;
  scope: Scope;
  fields?: string[] | null;
  reason: string;
  expiresAt?: string | null;
}): Promise<{ id: string }> {
  return identityRequest('/api/access/override', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function revokeAccessOverride(overrideId: string): Promise<{ id: string; revoked: true }> {
  return identityRequest(`/api/access/override/${encodeURIComponent(overrideId)}`, {
    method: 'DELETE',
  });
}

export function getRoleChangeRequests(
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending',
): Promise<{ requests: RoleChangeRequest[] }> {
  return identityRequest(`/api/access/role-change-requests?status=${status}`);
}

export function getRoleChangeRequestAccess(): Promise<{ canRequest: true }> {
  return identityRequest('/api/access/role-change-request-access');
}

export function requestRoleChange(input: {
  subjectUserId: string;
  toPositionId: string;
  requestedTeamId: string | null;
  requestedReportsTo: string | null;
  reason: string;
}): Promise<{ id: string; status: 'pending' }> {
  return identityRequest('/api/access/role-change-request', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function decideRoleChange(
  requestId: string,
  input: { approved: boolean; reason: string },
): Promise<{ id: string; status: 'approved' | 'rejected' }> {
  return identityRequest(`/api/access/role-change-request/${encodeURIComponent(requestId)}/decide`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
