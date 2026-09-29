/**
 * The biometric module's surface — registrars called from `modules/index.ts`.
 * Step 5a: the tenant tables, the pure reading/mapping/burst rules and the
 * admin API. Step 5b: receipt, processing, replay, recovery and health. The
 * machine router (5c) follows.
 */
export { registerBiometricPolicies } from './policy.js';
export { registerBiometricRoutes } from './routes.js';
export { registerBiometricJobs } from './jobs.js';
