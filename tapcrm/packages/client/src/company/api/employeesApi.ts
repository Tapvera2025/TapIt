import { identityRequest } from '../../identity/api/authApi.js';

export interface CreateEmployeeInput {
  email: string;
  fullName: string;
  password: string;
  confirmPassword: string;
  departmentId: string;
  positionId: string;
  teamId?: string;
  specialization?: string;
  reportsTo?: string | null;
}

export async function createEmployee(input: CreateEmployeeInput): Promise<{ employee: { id: string; email: string; fullName: string; status: string }; credentials: { delivery: string; status: string } }> {
  return identityRequest('/api/users', { method: 'POST', body: JSON.stringify(input) });
}
