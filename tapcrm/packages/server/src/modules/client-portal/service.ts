import { z } from 'zod';
import type { RequestContext } from '../../platform/dal/context.js';
import { ApplicationError } from '../../errors.js';
import { countProjectsByStatus, findProfile, findProject, listProjects } from './repository.js';
import type { PortalDashboard, PortalProfile, PortalProject } from './types.js';

const projectIdSchema = z.string().uuid();

/**
 * The only way a handler obtains a client id. Employees and service accounts
 * are refused outright; a client without a bound account fails closed (A2).
 */
function requireClientId(ctx: RequestContext): string {
  const { principal } = ctx;
  if (principal.accountType !== 'client' || !principal.clientId) {
    throw new ApplicationError('The client portal is only available to client accounts', 403, 'CLIENT_PORTAL_FORBIDDEN');
  }
  return principal.clientId;
}

const notFound = () => new ApplicationError('Project not found', 404, 'CLIENT_PORTAL_NOT_FOUND');

export async function getProfile(ctx: RequestContext): Promise<PortalProfile> {
  const profile = await findProfile(ctx, requireClientId(ctx));
  if (!profile) throw new ApplicationError('This client account is inactive', 403, 'CLIENT_PORTAL_INACTIVE');
  return profile;
}

export async function getDashboard(ctx: RequestContext): Promise<PortalDashboard> {
  const clientId = requireClientId(ctx);
  const [profile, counts, recentProjects] = await Promise.all([
    getProfile(ctx),
    countProjectsByStatus(ctx, clientId),
    listProjects(ctx, clientId, 5),
  ]);
  return {
    profile: { clientName: profile.clientName, businessName: profile.businessName, organizationName: profile.organizationName },
    counts,
    recentProjects,
  };
}

export async function getProjects(ctx: RequestContext): Promise<PortalProject[]> {
  return listProjects(ctx, requireClientId(ctx));
}

/** CP-2: a malformed id and another client's project are both a plain 404. */
export async function getProject(ctx: RequestContext, id: string): Promise<PortalProject> {
  const clientId = requireClientId(ctx);
  const parsed = projectIdSchema.safeParse(id);
  if (!parsed.success) throw notFound();
  const project = await findProject(ctx, clientId, parsed.data);
  if (!project) throw notFound();
  return project;
}
