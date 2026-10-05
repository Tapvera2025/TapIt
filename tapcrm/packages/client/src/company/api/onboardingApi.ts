import type { OnboardingStepDto, OnboardingWorkflowDto } from '@tapcrm/contracts';
import { peopleMutation, peopleRead } from './client.js';

export function listOnboardingWorkflows(params?: {
  status?: string;
  employeeId?: string;
}): Promise<OnboardingWorkflowDto[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.employeeId) query.set('employeeId', params.employeeId);
  const qStr = query.toString() ? `?${query.toString()}` : '';
  return peopleRead<OnboardingWorkflowDto[]>(`/api/onboarding${qStr}`, { staleMs: 5_000 });
}

export function completeOnboardingStep(
  workflowId: string,
  stepId: string,
  body?: { notes?: string },
): Promise<OnboardingStepDto> {
  return peopleMutation<OnboardingStepDto>(
    `/api/onboarding/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(stepId)}/complete`,
    {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    },
    ['/api/onboarding'],
  );
}
