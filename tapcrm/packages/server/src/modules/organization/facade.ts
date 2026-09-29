/**
 * Organization's public surface for other modules — MB-1, MB-5.
 *
 * Another module imports this file and nothing else from `organization`;
 * `npm run ci` refuses any other cross-module import. Keep the list narrow and
 * the callers known:
 *
 *   employee           getOrganizationChart, listReportingManagerOptions,
 *                      validateManagerAssignment
 *   access-management  validateManagerAssignment, findTeam
 */
export { getOrganizationChart } from './chart/service.js';
export { listReportingManagerOptions, validateManagerAssignment } from './reporting/service.js';
export { findTeam } from './teams/repository.js';
