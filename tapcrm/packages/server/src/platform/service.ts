/** Platform service façade; subdomains own their business logic. */
export {
  login,
  refresh,
  logout,
  authenticate,
  createPasswordHash,
} from './auth/service.js';
export {
  createOrganization,
  getOrganization,
  changeStatus,
} from './organizations/service.js';
export {
  catalog,
  listOrganizationModules,
  changeOrganizationModule,
} from './modules/service.js';
export { createInvitation, resendInvitation } from './invitations/service.js';
export { getStats } from './dashboard/service.js';
