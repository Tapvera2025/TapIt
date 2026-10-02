import { peopleRead, peopleMutation } from './client.js';

export interface Holiday {
  id: string;
  name: string;
  type: string;
  holidayDate: string | null;
  recurrence: Record<string, unknown> | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: 'active' | 'withdrawn';
  createdAt: string;
  scopeCount: number;
}

export function listHolidays(params?: { from?: string; to?: string }): Promise<{ holidays: Holiday[] }> {
  const q = new URLSearchParams();
  if (params?.from) q.set('from', params.from);
  if (params?.to) q.set('to', params.to);
  const qs = q.toString();
  return peopleRead<{ holidays: Holiday[] }>(`/api/holidays${qs ? `?${qs}` : ''}`, { staleMs: 300_000 });
}

export function createHoliday(body: {
  name: string;
  type: string;
  holidayDate?: string;
  recurrence?: unknown;
  effectiveFrom?: string;
  effectiveTo?: string;
}): Promise<{ id: string }> {
  return peopleMutation('/api/holidays', { method: 'POST', body: JSON.stringify(body) }, ['/api/holidays']);
}
