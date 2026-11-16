/**
 * Deep link that opens the Projects page with the "New project" modal
 * already open for one client — used by the "Client added" toast on the
 * Clients page. ProjectsPage reads the param once and then drops it from
 * the address bar, so Back/refresh don't reopen the modal.
 */
export const NEW_PROJECT_CLIENT_PARAM = 'newProjectFor';

export function newProjectForClientPath(clientId: string): string {
  return `/company/projects?${NEW_PROJECT_CLIENT_PARAM}=${encodeURIComponent(clientId)}`;
}
