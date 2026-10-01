import { visibilityFilter, type Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { hashIdentityPassword } from '../identity/facade.js';
import { ClientEmailTakenError, ClientNotFoundError } from './errors.js';
import {
  clientEmailExists,
  deactivateClientLogin,
  emailExists,
  findClientById,
  findClientLoginUserId,
  findClientLoginUserIdTx,
  findClientProjectAssigneeIds,
  insertClient,
  insertClientLogin,
  listClients as repoListClients,
  resetClientLoginPassword,
  updateClientRow,
} from './repository.js';
import { REGION_CURRENCY, REGION_TIMEZONE, type Client, type ClientListQuery, type PaginatedClients } from './types.js';
import type { CreateClientInput, ResetClientCredentialsInput, UpdateClientInput } from './validators.js';

export async function loadClientResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const client = await findClientById(ctx, id);
  if (!client) return null;
  const projectAssigneeIds = await findClientProjectAssigneeIds(ctx, id);
  return { type: 'client', id: client.id, organizationId: client.organizationId, createdBy: client.createdBy, projectAssigneeIds };
}

export async function listClients(ctx: RequestContext, query: ClientListQuery): Promise<PaginatedClients> {
  const filter = await visibilityFilter(ctx, 'clients:view', 'client');
  return repoListClients(ctx, filter, query);
}

export async function getClient(ctx: RequestContext, id: string): Promise<Client> {
  const client = await findClientById(ctx, id);
  if (!client) throw new ClientNotFoundError();
  return client;
}

/**
 * Creates the client record AND its login (app_user, account_type='client')
 * in one transaction: a client that exists but cannot ever log in, or a
 * login with no client record behind it, are both defects this guards
 * against. No client-portal UI reads this login yet (Phase 5) — see
 * team-docs — but the account is real from day one so nothing has to be
 * backfilled when that UI lands.
 */
export async function createClient(ctx: RequestContext, input: CreateClientInput): Promise<Client> {
  // TX-2: the breach check inside hashIdentityPassword is an external network
  // call, so it happens before the transaction opens, never inside it.
  const passwordHash = await hashIdentityPassword(input.password);

  const { id } = await db.transaction(ctx, async (tx) => {
    if (await emailExists(tx, input.email)) throw new ClientEmailTakenError(input.email);

    const client = await insertClient(tx, ctx.organizationId, ctx.principal.id, {
      clientName: input.clientName,
      businessName: input.businessName,
      email: input.email,
      region: input.region,
      currency: REGION_CURRENCY[input.region],
      timezone: REGION_TIMEZONE[input.region],
    });
    await insertClientLogin(tx, ctx.organizationId, client.id, { email: input.email, passwordHash, fullName: input.clientName });
    return client;
  });

  const created = await findClientById(ctx, id);
  if (!created) throw new ClientNotFoundError();
  return created;
}

export async function updateClient(ctx: RequestContext, id: string, input: UpdateClientInput): Promise<Client> {
  const existing = await findClientById(ctx, id);
  if (!existing) throw new ClientNotFoundError();

  await db.transaction(ctx, (tx) =>
    updateClientRow(tx, ctx.organizationId, id, {
      ...(input.clientName !== undefined ? { clientName: input.clientName } : {}),
      ...(input.businessName !== undefined ? { businessName: input.businessName } : {}),
      ...(input.region !== undefined ? { region: input.region, currency: REGION_CURRENCY[input.region], timezone: REGION_TIMEZONE[input.region] } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    }),
  );

  const updated = await findClientById(ctx, id);
  if (!updated) throw new ClientNotFoundError();
  return updated;
}

/** `POST .../credentials` — sets (or resets) the client's login password. */
export async function setClientCredentials(ctx: RequestContext, id: string, input: ResetClientCredentialsInput): Promise<{ hasActiveLogin: boolean }> {
  const client = await findClientById(ctx, id);
  if (!client) throw new ClientNotFoundError();

  const passwordHash = await hashIdentityPassword(input.password); // TX-2: before the transaction, see createClient above.
  await db.transaction(ctx, async (tx) => {
    const existingUserId = await findClientLoginUserIdTx(tx, ctx.organizationId, id);
    if (existingUserId) {
      await resetClientLoginPassword(tx, ctx.organizationId, existingUserId, passwordHash);
    } else {
      await insertClientLogin(tx, ctx.organizationId, id, { email: client.email, passwordHash, fullName: client.clientName });
    }
  });
  return { hasActiveLogin: true };
}

/** `DELETE .../credentials` — revokes the login (session_version bump + deactivate); the client record itself is untouched. */
export async function revokeClientCredentials(ctx: RequestContext, id: string): Promise<{ hasActiveLogin: boolean }> {
  const client = await findClientById(ctx, id);
  if (!client) throw new ClientNotFoundError();

  const userId = await findClientLoginUserId(ctx, id);
  if (userId) await db.transaction(ctx, (tx) => deactivateClientLogin(tx, ctx.organizationId, userId));
  return { hasActiveLogin: false };
}

export { clientEmailExists };
