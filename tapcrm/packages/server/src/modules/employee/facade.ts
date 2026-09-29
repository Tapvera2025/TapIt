/**
 * The employee directory's public surface for other modules — MB-1, MB-5.
 *
 * Another module imports this file and nothing else from `employee`.
 * Callers:
 *
 *   attendance  EMPLOYEE_EVENTS, EmploymentChanged — re-judges a person's
 *               days when their joining or leaving date moves
 */
export { EMPLOYEE_EVENTS, type EmploymentChanged } from './events.js';
