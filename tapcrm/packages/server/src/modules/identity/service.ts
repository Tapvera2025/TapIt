export { login } from './authentication/login.js';
export { resolvePrincipal, resolvePrincipalFromToken } from './authentication/authenticate.js';
export { logout } from './authentication/logout.js';
export { refreshIdentitySession as refresh } from './sessions/service.js';
export {
  getActiveSessions,
  revokeOneSession,
  revokeEverySession,
} from './sessions/service.js';
