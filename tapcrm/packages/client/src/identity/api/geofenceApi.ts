import { identityRequest } from './authApi.js';

export interface GeofenceUser { id: string; fullName: string; email: string; geofenceRequired: boolean }
export interface GeofenceLocation { id: string; name: string; latitude: number; longitude: number; radiusMetres: number; accuracyThresholdMetres: number; status: 'active' | 'inactive'; assignments: Array<{ userId: string; userName: string; userEmail: string; bypassUntil: string | null }> }
export interface GeofenceAppeal { id: string; userId: string; userName: string; userEmail: string; accuracyMetres: number | null; reason: string; status: 'pending' | 'approved' | 'denied' | 'used'; bypassUntil: string | null; createdAt: string; locations: Array<{ id: string; name: string }> }
export interface GeofenceAdminData { locations: GeofenceLocation[]; users: GeofenceUser[]; appeals: GeofenceAppeal[] }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return identityRequest<T>(path, init);
}

export function getGeofenceAdminData(): Promise<GeofenceAdminData> { return request('/api/identity/geofences', { method: 'GET' }); }

export function decideGeofenceAppeal(id: string, input: { decision: 'approve' | 'deny'; locationId?: string; until?: string }): Promise<unknown> {
  return request(`/api/identity/geofence-appeals/${id}/decide`, { method: 'POST', body: JSON.stringify(input) });
}

export function createGeofenceLocation(input: Omit<GeofenceLocation, 'id' | 'status' | 'assignments'>): Promise<GeofenceLocation> {
  return request('/api/identity/geofences', { method: 'POST', body: JSON.stringify(input) });
}

export function updateGeofenceLocation(id: string, input: Partial<Omit<GeofenceLocation, 'id' | 'assignments'>>): Promise<GeofenceLocation> {
  return request(`/api/identity/geofences/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function setGeofenceAssignment(locationId: string, userId: string, enabled: boolean): Promise<{ id: string; geofenceRequired: boolean }> {
  return request(`/api/identity/geofences/${locationId}/assign`, { method: 'POST', body: JSON.stringify({ userId, enabled }) });
}
