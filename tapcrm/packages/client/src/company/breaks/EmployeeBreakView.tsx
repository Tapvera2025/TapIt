import { useEffect, useState } from 'react';
import {
  getBreakAllowance,
  getBreakPrompts,
  submitBreachExplanation,
  type BreakAllowance,
  type BreakPrompt,
} from '../api/breaksApi.js';

export function EmployeeBreakView(): React.JSX.Element {
  const [allowance, setAllowance] = useState<BreakAllowance | null>(null);
  const [prompts, setPrompts] = useState<BreakPrompt[]>([]);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([getBreakAllowance(), getBreakPrompts()])
      .then(([a, p]) => { setAllowance(a); setPrompts(p); })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="p-4 text-red-600">{error}</p>;
  if (!allowance) return <p className="p-4 text-app-muted">Loading...</p>;

  async function handleExplanation(breachId: string): Promise<void> {
    const text = explanations[breachId];
    if (!text?.trim()) return;
    setSubmitting(breachId);
    try {
      await submitBreachExplanation(breachId, text);
      setPrompts((prev) => prev.filter((p) => p.breachId !== breachId));
    } finally {
      setSubmitting(null);
    }
  }

  const warningColor = (state: string): string =>
    state === 'breach' ? 'text-red-600' : state === 'warning' ? 'text-yellow-600' : 'text-green-600';

  return (
    <div className="space-y-6 p-6">
      <section>
        <h2 className="font-display text-lg font-semibold mb-3">Today's Break Allowance</h2>
        {allowance.noPolicy ? (
          <p className="text-sm text-app-muted">No break policy configured. All break time is paid.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-app-border p-4">
              <p className="text-xs text-app-muted uppercase tracking-wide mb-1">Total Break Used</p>
              <p className={`text-2xl font-bold ${warningColor(allowance.warning.totalState)}`}>
                {allowance.usage.totalMinutes} min
              </p>
              {allowance.policy?.upperTotalMinutes != null && (
                <p className="text-xs text-app-muted mt-1">
                  Limit: {allowance.policy.upperTotalMinutes} min
                  {allowance.warning.totalState === 'warning' && ' — approaching limit'}
                  {allowance.warning.totalState === 'breach' && ' — exceeded'}
                </p>
              )}
            </div>
            <div className="rounded border border-app-border p-4">
              <p className="text-xs text-app-muted uppercase tracking-wide mb-1">Breaks Taken</p>
              <p className="text-2xl font-bold">{allowance.usage.count}</p>
            </div>
          </div>
        )}
      </section>

      {prompts.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold mb-3">Pending Explanations</h2>
          <div className="space-y-4">
            {prompts.map((prompt) => (
              <div key={prompt.breachId} className="rounded border border-yellow-300 bg-yellow-50 p-4">
                <p className="text-sm font-medium">{prompt.workDate} — {prompt.ruleCondition}</p>
                <p className="text-xs text-app-muted mt-1">
                  Break used: {prompt.measuredTotalMinutes} min total, {prompt.measuredSingleMinutes} min longest
                </p>
                <textarea
                  className="mt-2 w-full rounded border border-app-border p-2 text-sm"
                  rows={3}
                  placeholder="Enter your explanation..."
                  value={explanations[prompt.breachId] ?? ''}
                  onChange={(e) => setExplanations((prev) => ({ ...prev, [prompt.breachId]: e.target.value }))}
                />
                <button
                  type="button"
                  className="mt-2 rounded bg-app-primary px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={submitting === prompt.breachId || !explanations[prompt.breachId]?.trim()}
                  onClick={() => void handleExplanation(prompt.breachId)}
                >
                  {submitting === prompt.breachId ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
