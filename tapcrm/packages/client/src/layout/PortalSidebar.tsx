/**
 * Canonical sidebar entry point for every authenticated portal.
 *
 * The implementation lives with the existing workspace navigation logic; this
 * portal-level name makes it explicit that the same component is shared by
 * company employees, clients, and master administrators.
 */
export { CompanySidebar as PortalSidebar } from '../company/layout/CompanySidebar.js';
