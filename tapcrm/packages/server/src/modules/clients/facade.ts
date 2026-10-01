import type { Tx } from '../../platform/dal/db.js';
import { findClientSummary } from './repository.js';
import type { ClientSummary } from './types.js';

/**
 * ClientFacade — the surface other modules call (MB-1). The projects module
 * uses this for the "business name autofills from the client" behaviour and
 * to snapshot the client's currency onto the new project.
 */
export async function getClientSummary(tx: Tx, organizationId: string, clientId: string): Promise<ClientSummary | null> {
  return findClientSummary(tx, organizationId, clientId);
}
