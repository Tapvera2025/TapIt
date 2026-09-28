export interface BreakAllowance {
  workDate: string;
  noPolicy: boolean;
  policy: {
    upperTotalMinutes: number | null;
    upperSingleMinutes: number | null;
    lowerTotalMinutes: number | null;
    graceMinutes: number;
    warningPercent: number;
  } | null;
  usage: { totalMinutes: number; longestMinutes: number; count: number };
  remaining: { totalMinutes: number | null; singleMinutes: number | null };
  warning: { totalState: string; singleState: string };
}

export interface BreakPrompt {
  breachId: string;
  workDate: string;
  ruleCondition: string;
  measuredTotalMinutes: number;
  measuredSingleMinutes: number;
}

export async function getBreakAllowance(): Promise<BreakAllowance> {
  const res = await fetch('/api/breaks/allowance/me', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load break allowance');
  return res.json() as Promise<BreakAllowance>;
}

export async function getBreakPrompts(): Promise<BreakPrompt[]> {
  const res = await fetch('/api/breaks/prompts/me', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load break prompts');
  return res.json() as Promise<BreakPrompt[]>;
}

export async function submitBreachExplanation(breachId: string, explanation: string): Promise<void> {
  const res = await fetch(`/api/breaks/breaches/${breachId}/explanation`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ explanation }),
  });
  if (!res.ok) throw new Error('Failed to submit explanation');
}

export interface BreachListItem {
  id: string;
  workDate: string;
  status: string;
  matchedRuleId: string | null;
  occurrenceNumber: number | null;
  autoApplied: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  waivedBy: string | null;
  waivedAt: string | null;
  waiverReason: string | null;
  explanation: string | null;
  createdAt: string;
}

export async function listBreaches(params?: { userId?: string; status?: string; limit?: number }): Promise<BreachListItem[]> {
  const q = new URLSearchParams();
  if (params?.userId) q.set('userId', params.userId);
  if (params?.status) q.set('status', params.status);
  if (params?.limit) q.set('limit', String(params.limit));
  const res = await fetch(`/api/breaks/breaches?${q.toString()}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load breaches');
  return res.json() as Promise<BreachListItem[]>;
}
