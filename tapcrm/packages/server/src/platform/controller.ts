/** Platform module façade. Feature-specific controllers live under each subdomain. */
export {
  loginController,
  refreshController,
  logoutController,
} from './auth/controller.js';
export {
  listController as listOrganizations,
  getController as getOrganization,
  createController as createOrganization,
  activateController,
  suspendController,
  adminController,
} from './organizations/controller.js';
export {
  catalogController as listModules,
  organizationModulesController,
  enableController,
  disableController,
} from './modules/controller.js';
