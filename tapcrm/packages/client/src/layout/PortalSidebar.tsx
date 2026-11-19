/**
 * Canonical sidebar entry point for every authenticated portal: company
 * employees and admins, clients, and master administrators all render this one
 * component, differing only in the menu their capabilities produce.
 */
export { PortalSidebar } from './sidebar/PortalSidebar.js';
export type { PortalSidebarProps } from './sidebar/PortalSidebar.js';
