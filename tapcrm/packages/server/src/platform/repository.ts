/** Repository façade; concrete repositories remain separated by subdomain. */
export * as authRepository from './auth/repository.js';
export * as organizationRepository from './organizations/repository.js';
export * as moduleRepository from './modules/repository.js';
export * as invitationRepository from './invitations/repository.js';
export * as dashboardRepository from './dashboard/repository.js';
