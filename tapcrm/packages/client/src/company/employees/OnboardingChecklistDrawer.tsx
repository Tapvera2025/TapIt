import { useEffect, useState } from 'react';
import type { OnboardingStepDto, OnboardingWorkflowDto } from '@tapcrm/contracts';
import { completeOnboardingStep, listOnboardingWorkflows } from '../api/onboardingApi.js';
import { SkeletonListItem } from '../../ui/components.js';

interface OnboardingChecklistDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  setupUrl?: string | null | undefined;
}

export function OnboardingChecklistDrawer({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  setupUrl,
}: OnboardingChecklistDrawerProps): React.JSX.Element | null {
  const [workflow, setWorkflow] = useState<OnboardingWorkflowDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !employeeId) return;
    setLoading(true);
    setError('');
    listOnboardingWorkflows({ employeeId })
      .then((workflows) => {
        setWorkflow(workflows[0] ?? null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Unable to load onboarding checklist');
      })
      .finally(() => setLoading(false));
  }, [isOpen, employeeId]);

  if (!isOpen) return null;

  async function handleCompleteStep(step: OnboardingStepDto): Promise<void> {
    if (!workflow || step.status === 'completed') return;
    setBusyStepId(step.id);
    try {
      await completeOnboardingStep(workflow.id, step.id);
      // Reload workflow
      const updated = await listOnboardingWorkflows({ employeeId });
      setWorkflow(updated[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete step');
    } finally {
      setBusyStepId(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
    >
      <div className="fixed inset-0 bg-[#080e17a6] backdrop-blur-xs transition-opacity" onClick={onClose} />

      <dialog
        open
        className="ui-dialog z-50 my-auto flex max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3.5rem)] w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-w-xl flex-col rounded-2xl border border-app-border bg-app-surface p-5 sm:p-6 shadow-2xl text-app-foreground overflow-hidden"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-app-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-bold">Onboarding Checklist</h2>
              {workflow && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                    workflow.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {workflow.status.replace('_', ' ')}
                </span>
              )}
            </div>
            <p className="text-xs text-app-muted mt-0.5">
              Employee: <span className="font-semibold text-app-foreground">{employeeName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="grid size-8 place-items-center rounded-lg text-xl text-app-muted hover:bg-app-background"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 pt-4 pb-4">
          {setupUrl && (
            <div className="rounded-xl border border-app-accent/30 bg-app-accent/5 p-3.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid size-6 place-items-center rounded-md bg-app-accent/20 text-xs font-bold text-app-accent">
                    🔗
                  </span>
                  <span className="font-semibold text-app-foreground">Employee Account Setup Link</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(setupUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="rounded-lg bg-app-accent px-3 py-1 font-semibold text-app-on-accent transition-opacity hover:opacity-90 active:scale-95"
                >
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-app-muted">
                Share this secure link with <strong className="text-app-foreground">{employeeName}</strong> to activate their account and set their permanent password (valid for 72 hours).
              </p>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-app-border bg-app-background/80 px-2.5 py-1.5 font-mono text-[11px] text-app-foreground select-all">
                <span className="truncate">{setupUrl}</span>
                <a
                  href={setupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-app-accent hover:underline text-[10px] font-sans font-semibold"
                >
                  Open ↗
                </a>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
              {error}
            </div>
          )}

          {loading ? (
            <div className="overflow-hidden rounded-xl border border-app-border bg-app-surface" role="status" aria-label="Loading onboarding checklist">
              {Array.from({ length: 4 }, (_, index) => <SkeletonListItem key={index} />)}
            </div>
          ) : error && !workflow ? null : !workflow ? (
            <div className="py-12 text-center text-sm text-app-muted">
              No active onboarding workflow found for this employee.
            </div>
          ) : (
            <>
              {/* Progress Bar */}
              <div className="rounded-xl border border-app-border bg-app-background/40 p-3">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Checklist Progress</span>
                  <span className="text-app-accent">{workflow.progress.percent}% ({workflow.progress.completed}/{workflow.progress.total})</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-app-border">
                  <div
                    className="h-full bg-app-accent transition-all duration-300"
                    style={{ width: `${workflow.progress.percent}%` }}
                  />
                </div>
              </div>

              {/* Steps List */}
              <div className="space-y-2.5 pb-2">
                {workflow.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    className={`flex flex-col sm:flex-row sm:items-start justify-between gap-3 rounded-xl border p-3 text-xs transition-colors ${
                      step.status === 'completed'
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-app-border bg-app-background/60'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                          step.status === 'completed'
                            ? 'bg-emerald-500 text-white'
                            : 'border border-app-border bg-app-surface text-app-muted'
                        }`}
                      >
                        {step.status === 'completed' ? '✓' : idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`font-semibold break-words ${step.status === 'completed' ? 'line-through text-app-muted' : 'text-app-foreground'}`}>
                          {step.title}
                        </p>
                        {step.description && (
                          <p className="mt-0.5 text-[11px] text-app-muted leading-relaxed break-words">{step.description}</p>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-app-muted">
                          <span>Role: <strong className="uppercase text-app-foreground">{step.ownerRole}</strong></span>
                          <span>·</span>
                          <span>Due: <strong className="text-app-foreground">{step.dueDate}</strong></span>
                          {step.completedByName && (
                            <>
                              <span>·</span>
                              <span>Completed by: {step.completedByName}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 pt-0.5 self-end sm:self-start">
                      {step.status === 'completed' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          Done
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busyStepId === step.id}
                          onClick={() => void handleCompleteStep(step)}
                          className="rounded border border-app-accent/60 bg-app-accent/10 px-2.5 py-1 text-[11px] font-bold text-app-accent hover:bg-app-accent hover:text-app-on-accent disabled:opacity-50"
                        >
                          {busyStepId === step.id ? 'Saving…' : 'Mark Done'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-app-border pt-3 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-app-border px-4 py-1.5 text-xs font-semibold hover:border-app-accent"
          >
            Close
          </button>
        </div>
      </dialog>
    </div>
  );
}
