import type { Principal } from '@tapcrm/contracts';

interface ResolverUser {
  id: string;
  organizationId: string;
  accountType: 'super-admin' | 'employee' | 'client' | 'service';
  sessionVersion: number;
  positionId: string | null;
  departmentId: string | null;
  teamId: string | null;
  reportsTo: string | null;
  clientId: string | null;
  organizationalLevel: number | null;
}

export function buildPrincipalForResolver(row: ResolverUser): Principal {
  const base = {
    id: row.id,
    organizationId: row.organizationId,
    sessionVersion: row.sessionVersion,
  };

  switch (row.accountType) {
    case 'super-admin':
      return {
        ...base,
        accountType: 'super-admin',
      };

    case 'client':
      if (!row.clientId) {
        throw new Error('Client account has no clientId');
      }

      return {
        ...base,
        accountType: 'client',
        clientId: row.clientId,
      };

    case 'service':
      return {
        ...base,
        accountType: 'service',
        allowedActions: [],
        allowedResources: [],
        expiresAt: new Date(0),
      };

    case 'employee':
      if (!row.positionId || !row.departmentId) {
        throw new Error('Employee account has no position or department');
      }

      return {
        ...base,
        accountType: 'employee',
        positionId: row.positionId,
        departmentId: row.departmentId,
        teamId: row.teamId,
        reportsTo: row.reportsTo,
        organizationalLevel: row.organizationalLevel ?? 0,
      };
  }
}
