import type { Principal } from '@tapcrm/contracts';
import { createRequestContext, type RequestContext } from '../../../platform/dal/context.js';

export interface IdentityUser {
  id: string;
  organizationId: string;
  accountType: 'super-admin' | 'employee' | 'client' | 'service';
  email: string;
  fullName: string;
  passwordHash: string | null;
  status: string;
  organizationStatus: 'active' | 'suspended';
  sessionVersion: number;
  positionId: string | null;
  departmentId: string | null;
  teamId: string | null;
  reportsTo: string | null;
  clientId: string | null;
  organizationalLevel: number | null;
  geofenceRequired: boolean;
  emailVerifiedAt?: Date | null;
}

export function toPrincipal(user: IdentityUser): Principal {
  const base = { id: user.id, organizationId: user.organizationId, sessionVersion: user.sessionVersion };
  if (user.accountType === 'super-admin') return { ...base, accountType: 'super-admin' };
  if (user.accountType === 'client') return { ...base, accountType: 'client', clientId: user.clientId ?? '' };
  if (user.accountType === 'service') return { ...base, accountType: 'service', allowedActions: [], allowedResources: [], expiresAt: new Date(0) };
  return { ...base, accountType: 'employee', positionId: user.positionId ?? '', departmentId: user.departmentId ?? '', teamId: user.teamId, reportsTo: user.reportsTo, organizationalLevel: user.organizationalLevel ?? 0 };
}

export function createIdentityContext(
  user: IdentityUser,
  requestId: string,
  sourceIp: string | null = null,
): RequestContext {
  return createRequestContext({
    organizationId: user.organizationId,
    principal: toPrincipal(user),
    requestId,
    sourceIp,
  });
}
