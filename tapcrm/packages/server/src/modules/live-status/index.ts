/**
 * live-status module surface — registrars called from `modules/index.ts`.
 *
 * The projector must be registered BEFORE the first `appendEvent` fires,
 * so attach it at boot. The channel must be defined BEFORE sockets accept
 * their first connection, so `roomsFor` sees it from the first handshake.
 */
export { registerLiveStatusPolicies } from './policy.js';
export { registerLiveStatusRoutes } from './routes.js';
export { registerLiveStatusJobs } from './jobs.js';
export { registerLiveStatusProjector } from './projector.js';
export { registerStatusChannel } from './channel.js';
