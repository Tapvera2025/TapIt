/**
 * Organization's public surface for other modules — MB-1, MB-5.
 *
 * Another module imports this file and nothing else from `organization`;
 * `npm run ci` refuses any other cross-module import. Keep the list narrow and
 * the callers known:
 *
 *   employee           getOrganizationChart, listReportingManagerOptions,
 *                      validateManagerAssignment, repairReportingLinesAfterMove
 *   access-management  validateManagerAssignment, repairReportingLinesAfterMove, findTeam
 *   break-management   effectiveManagerId (the "notify manager" break consequence)
 */
export { getOrganizationChart } from './chart/service.js';
export {
  effectiveManagerId,
  listReportingManagerOptions,
  repairReportingLinesAfterMove,
  validateManagerAssignment,
  type ClearedReportingLine,
} from './reporting/service.js';
export { findTeam } from './teams/repository.js';
