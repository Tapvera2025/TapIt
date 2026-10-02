import type { DashboardPreferences, DashboardPreferencesInput } from '@tapcrm/contracts';
import { identityRequest } from '../../identity/api/authApi.js';

export function getDashboardPreferences(): Promise<DashboardPreferences> {
  return identityRequest<DashboardPreferences>('/api/dashboard/preferences');
}

export function saveDashboardPreferences(input: DashboardPreferencesInput): Promise<DashboardPreferences> {
  return identityRequest<DashboardPreferences>('/api/dashboard/preferences', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
