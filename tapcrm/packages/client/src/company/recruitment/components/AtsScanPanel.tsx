import { useCallback, useEffect, useState } from 'react';
import {
  ATS_CATEGORY_LABELS,
  ATS_CATEGORY_ORDER,
  atsScoreBand,
  countAtsMissingRequired,
  type AtsBreakdown,
  type AtsCheck,
  type AtsCriteria,
  type AtsCriteriaSettings,
  type AtsScanReport,
  type AtsSubmissionScanState,
} from '@tapcrm/contracts';
import { Button, Notice } from '../../../ui/components.js';
import { getSubmissionAts, runAtsScan } from '../api/recruitmentApi.js';
import type { CandidateResumeSubmission } from '../types/index.js';
import { AtsCriteriaModal } from './AtsCriteriaModal.js';
import { ATS_TONE_CLASSES, ATS_TONE_STROKE, atsLabel, atsTone, type AtsTone } from './AtsScoreBadge.js';

const FORMAT_LABELS: Readonly<Record<string, string>> = {
  pdf: 'PDF',
  docx: 'Word (DOCX)',
  doc: 'Word 97–2003 (DOC)',
  txt: 'Plain text',
  unknown: 'Unknown format',
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** One line for HR notes, so the score travels with the decision. */
export function atsDecisionNote(report: AtsScanReport): string {
  if (report.score === null) {
    return 'ATS screening could not score this resume (needs manual review).';
  }
  const missing = report.checks
    .filter((check) => check.category !== 'preferred_skills' && check.outcome === 'not_found')
    .map((check) => check.criterion);
  return [
    'ATS screening: ' + String(report.score) + '/100 (' + atsScoreBand(report.score, missing.length).label + ') on ' + new Date(report.createdAt).toLocaleDateString() + '.',
    missing.length > 0 ? 'Missing required: ' + missing.join(', ') + '.' : 'All required items found.',
  ].join(' ');
}

function ScoreRing({ score, tone, label }: { readonly score: number | null; readonly tone: AtsTone; readonly label: string }): React.JSX.Element {
  const percent = score === null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <div
      className="relative size-28 shrink-0"
      role="img"
      aria-label={score === null ? 'ATS score unavailable: needs manual review' : 'ATS score ' + String(score) + ' out of 100, ' + label}
    >
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r="50" fill="none" stroke="var(--app-border)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke={ATS_TONE_STROKE[tone]}
          strokeWidth="10"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${percent} 100`}
          className="chart-ring"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-app-foreground">{score ?? '—'}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-app-muted">{score === null ? 'review' : 'of 100'}</span>
      </div>
    </div>
  );
}

function BreakdownRow({ item, report }: { readonly item: AtsBreakdown; readonly report: AtsScanReport }): React.JSX.Element {
  const share = item.weight > 0 ? Math.round((item.points / item.weight) * 100) : 0;
  const detail = item.category === 'experience'
    ? (report.extractedExperienceYears === null ? 'Not measurable' : '≈' + String(report.extractedExperienceYears) + ' yrs')
      + ' · ' + String(report.criteria.minimumExperienceYears ?? 0) + ' required'
    : String(item.matchedCount) + ' of ' + String(item.criteriaCount) + ' found'
      + (item.uncertainCount > 0 ? ' · ' + String(item.uncertainCount) + ' to confirm' : '');
  return (
    <div className="grid grid-cols-[7.5rem_1fr_8.5rem] items-center gap-3 text-xs">
      <span className="font-semibold text-app-foreground">{item.label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-app-border" aria-hidden="true">
        <span
          className="block h-full rounded-full"
          style={{ width: `${share}%`, background: share >= 80 ? ATS_TONE_STROKE.strong : share >= 50 ? ATS_TONE_STROKE.partial : ATS_TONE_STROKE.low }}
        />
      </span>
      <span className="text-right tabular-nums text-app-muted">
        <span className="font-semibold text-app-foreground">{item.points}</span> / {item.weight} pts
        <span className="block text-[11px]">{detail}</span>
      </span>
    </div>
  );
}

const OUTCOME_STYLE: Readonly<Record<AtsCheck['outcome'], { symbol: string; label: string; className: string }>> = {
  matched: { symbol: '✓', label: 'Found', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  uncertain: { symbol: '?', label: 'To confirm', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  not_found: { symbol: '✕', label: 'Not found', className: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
};

function CheckRow({ check }: { readonly check: AtsCheck }): React.JSX.Element {
  const style = OUTCOME_STYLE[check.outcome];
  return (
    <li className="flex gap-2.5 py-2">
      <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${style.className}`} aria-hidden="true">
        {style.symbol}
      </span>
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-semibold text-app-foreground">
          {check.criterion}
          <span className="sr-only">: {style.label}</span>
          {check.outcome === 'uncertain' && <span className="ml-2 font-medium text-amber-700 dark:text-amber-300">to confirm</span>}
        </p>
        {check.note && <p className="mt-0.5 text-app-muted">{check.note}</p>}
        {check.evidence ? (
          <blockquote className="mt-1 border-l-2 border-app-border pl-2 italic text-app-muted">“{check.evidence}”</blockquote>
        ) : check.outcome === 'not_found' && !check.note ? (
          <p className="mt-0.5 text-app-muted">No mention in the resume.</p>
        ) : null}
      </div>
    </li>
  );
}

function CriteriaChips({ criteria }: { readonly criteria: AtsCriteria }): React.JSX.Element {
  const groups: Array<{ label: string; values: readonly string[] }> = [
    { label: 'Required', values: criteria.requiredSkills },
    { label: 'Preferred', values: criteria.preferredSkills },
    { label: 'Qualifications', values: criteria.requiredQualifications },
  ];
  return (
    <div className="space-y-1.5 text-xs">
      {groups.filter((group) => group.values.length > 0).map((group) => (
        <div key={group.label} className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 text-app-muted">{group.label}</span>
          {group.values.map((value) => (
            <span key={value} className="rounded-md border border-app-border bg-app-surface-raised px-2 py-0.5 font-medium text-app-foreground">
              {value}
            </span>
          ))}
        </div>
      ))}
      {(criteria.minimumExperienceYears ?? 0) > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="w-24 shrink-0 text-app-muted">Experience</span>
          <span className="font-medium text-app-foreground">{criteria.minimumExperienceYears}+ years</span>
        </div>
      )}
    </div>
  );
}

/**
 * ATS screening inside the resume review window: criteria for the job, the
 * latest scored report with its evidence, earlier reports, and the HR
 * decision buttons. The score informs the decision; it never makes it.
 */
export function AtsScanPanel({
  submission,
  onScanned,
  onAccept,
  onReject,
}: {
  readonly submission: CandidateResumeSubmission;
  readonly onScanned?: ((report: AtsScanReport) => void) | undefined;
  readonly onAccept?: ((atsNote: string | null) => void) | undefined;
  readonly onReject?: ((atsNote: string | null) => void) | undefined;
}): React.JSX.Element {
  const [state, setState] = useState<AtsSubmissionScanState | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<'edit' | 'setup' | null>(null);

  const open = submission.status === 'submitted' || submission.status === 'reviewed';
  const jobLabel = [submission.requisitionNumber, submission.requisitionTitle].filter(Boolean).join(' — ') || 'this job';

  const load = useCallback(async () => {
    try {
      setState(await getSubmissionAts(submission.id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load ATS screening.');
    } finally {
      setLoading(false);
    }
  }, [submission.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const report = await runAtsScan(submission.id);
      onScanned?.(report);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The ATS scan could not be completed.');
    } finally {
      setScanning(false);
    }
  }

  function criteriaSaved(settings: AtsCriteriaSettings) {
    const runAfter = editing === 'setup' && open;
    setEditing(null);
    setState((previous) => (previous ? { ...previous, settings } : previous));
    if (runAfter) void scan();
    else void load();
  }

  const latest = state?.scans[0] ?? null;
  const earlier = state?.scans.slice(1) ?? [];
  const latestMissing = latest ? countAtsMissingRequired(latest.checks) : 0;
  const tone = latest ? atsTone(latest.status, latest.score, latestMissing) : 'none';
  const label = latest ? atsLabel(latest.status, latest.score, latestMissing) : '';
  // An unreadable resume has no evidence either way, so nothing is reported missing.
  const missing = latest && latest.score !== null
    ? latest.checks.filter((check) => check.category !== 'preferred_skills' && check.outcome === 'not_found')
    : [];
  const checkCount = latest?.checks.length ?? 0;
  const metCount = latest?.checks.filter((check) => check.outcome === 'matched').length ?? 0;

  return (
    <section className="rounded-xl border border-app-border bg-app-surface p-4" aria-labelledby={`ats-${submission.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 id={`ats-${submission.id}`} className="font-semibold text-app-foreground">ATS screening</h4>
            <span className="rounded-full bg-app-accent/10 px-2 py-0.5 text-[10px] font-bold text-app-accent">Decision support</span>
          </div>
          <p className="mt-0.5 text-[11px] text-app-muted">
            Compares the resume with this job&apos;s criteria and shows the evidence. You make the decision.
          </p>
        </div>
        {state?.settings.configured && (
          <div className="flex flex-wrap gap-2">
            <Button kind="secondary" className="px-3 py-1.5 text-xs" onClick={() => setEditing('edit')} disabled={scanning}>
              Edit criteria
            </Button>
            {open && (!latest || latest.stale) && (
              <Button kind="primary" className="px-3 py-1.5 text-xs" onClick={() => void scan()} disabled={scanning}>
                {scanning ? 'Scanning…' : latest ? 'Re-scan with current criteria' : 'Run ATS scan'}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Notice error>{error}</Notice>
        </div>
      )}

      {loading ? (
        <div className="mt-4 h-24 animate-pulse rounded-lg bg-app-surface-raised" />
      ) : !state ? null : !state.settings.configured ? (
        <div className="mt-4 rounded-lg border border-dashed border-app-border p-4">
          <p className="text-sm font-semibold text-app-foreground">No screening criteria for this job yet</p>
          <p className="mt-1 text-xs text-app-muted">
            Set what {jobLabel} needs once; every application to the job is then scored against the same criteria.
            {state.settings.criteria.requiredSkills.length > 0 || state.settings.criteria.requiredQualifications.length > 0
              ? ' A starting point was drawn from the job description:'
              : ''}
          </p>
          <div className="mt-3">
            <CriteriaChips criteria={state.settings.criteria} />
          </div>
          <div className="mt-4">
            <Button kind="primary" className="px-3 py-1.5 text-xs" onClick={() => setEditing('setup')} disabled={scanning}>
              {open ? 'Review criteria & run scan' : 'Review criteria'}
            </Button>
          </div>
        </div>
      ) : !latest ? (
        <div className="mt-4 space-y-3">
          <CriteriaChips criteria={state.settings.criteria} />
          {!open && <p className="text-xs text-app-muted">This application has already been decided, so it can no longer be scanned.</p>}
          {scanning && <p className="text-xs text-app-muted">Reading the resume and checking each criterion…</p>}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {latest.stale && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              This report was made with earlier criteria for this job. {open ? 'Re-scan to score it against the current criteria.' : 'It is kept for reference.'}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <ScoreRing score={latest.score} tone={tone} label={label} />
            <div className="min-w-0 flex-1 space-y-2">
              <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-sm font-bold ${ATS_TONE_CLASSES[tone]}`}>
                {latest.score === null ? 'Needs manual review' : label}
              </span>
              {latest.score !== null && (
                <p className="text-xs text-app-muted">
                  {metCount} of {checkCount} criteria found
                  {countAtsMissingRequired(latest.checks) === 0 ? ' · all must-haves present' : ''}
                </p>
              )}
              {missing.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold text-rose-700 dark:text-rose-300">Missing must-haves:</span>
                  {missing.map((check) => (
                    <span key={check.criterion} className="rounded-md border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 font-medium text-rose-700 dark:text-rose-300">
                      {check.criterion}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-app-muted">
                Scanned {formatDateTime(latest.createdAt)}
                {latest.scannedByName ? ' by ' + latest.scannedByName : ''} · {FORMAT_LABELS[latest.extraction.format] ?? latest.extraction.format}
                {latest.extraction.pageCount ? ' · ' + String(latest.extraction.pageCount) + (latest.extraction.pageCount === 1 ? ' page' : ' pages') : ''}
                {' · ' + latest.extraction.characters.toLocaleString() + ' characters read'}
                {latest.extraction.ocrPages ? ' from a scanned image (OCR)' : ''}
              </p>
            </div>
          </div>

          {latest.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              {latest.warnings.map((warning) => (
                <li key={warning}>⚠ {warning}</li>
              ))}
            </ul>
          )}

          {latest.breakdown.length > 0 && latest.score !== null && (
            <div className="space-y-2.5 rounded-lg bg-app-surface-raised p-3">
              {latest.breakdown.map((item) => (
                <BreakdownRow key={item.category} item={item} report={latest} />
              ))}
            </div>
          )}

          <details className="group rounded-lg border border-app-border" open={latest.score !== null}>
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-app-foreground">
              Evidence for each criterion ({checkCount})
            </summary>
            <div className="border-t border-app-border px-3 pb-2">
              {ATS_CATEGORY_ORDER.map((category) => {
                const checks = latest.checks.filter((check) => check.category === category);
                if (checks.length === 0) return null;
                return (
                  <div key={category} className="pt-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-app-muted">{ATS_CATEGORY_LABELS[category]}</p>
                    <ul className="divide-y divide-app-border">
                      {checks.map((check) => (
                        <CheckRow key={category + check.criterion} check={check} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </details>

          {earlier.length > 0 && (
            <details className="rounded-lg border border-app-border">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-app-foreground">
                Earlier reports ({earlier.length})
              </summary>
              <ul className="divide-y divide-app-border border-t border-app-border text-xs">
                {earlier.map((scan) => (
                  <li key={scan.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="text-app-muted">
                      {formatDateTime(scan.createdAt)}
                      {scan.scannedByName ? ' · ' + scan.scannedByName : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      {scan.stale && <span className="text-amber-700 dark:text-amber-300">earlier criteria</span>}
                      <span className={`rounded-md border px-2 py-0.5 font-semibold ${ATS_TONE_CLASSES[atsTone(scan.status, scan.score, countAtsMissingRequired(scan.checks))]}`}>
                        {(scan.score === null ? '' : String(scan.score) + ' · ') + atsLabel(scan.status, scan.score, countAtsMissingRequired(scan.checks))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {open && latest && (onAccept || onReject) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3">
          <p className="text-xs text-app-muted">Check the evidence and the resume, then decide.</p>
          <div className="flex flex-wrap gap-2">
            {onReject && (
              <Button kind="danger" className="px-3 py-1.5 text-xs" onClick={() => onReject(atsDecisionNote(latest))} disabled={scanning}>
                Reject application
              </Button>
            )}
            {onAccept && (
              <Button kind="primary" className="px-3 py-1.5 text-xs" onClick={() => onAccept(atsDecisionNote(latest))} disabled={scanning}>
                Accept &amp; add as candidate
              </Button>
            )}
          </div>
        </div>
      )}

      <details className="mt-3 text-[11px] text-app-muted">
        <summary className="cursor-pointer select-none font-semibold">How this score works</summary>
        <p className="mt-1.5 leading-relaxed">
          The scan reads the resume text and looks for each criterion set for this job: required skills (including common
          aliases such as “k8s” for Kubernetes), years of experience from employment dates, qualifications, and preferred
          skills. Points are weighted by category and every point is backed by a quoted resume line. Ambiguous mentions
          are marked “to confirm” and earn half credit, and “Strong match” is only shown when every must-have is present.
          The scan never looks at name, photo, age, gender, address or other
          personal details, and it never accepts or rejects anyone. Scanned resumes are read with text recognition (OCR)
          on our servers and marked as such; a resume with too little readable text is flagged for manual review instead
          of being scored low. Each report is stored unchanged with the criteria it used.
        </p>
      </details>

      {editing && state && (
        <AtsCriteriaModal
          requisitionId={submission.requisitionId}
          requisitionLabel={jobLabel}
          initial={state.settings}
          saveLabel={editing === 'setup' && open ? 'Save & run scan' : 'Save criteria'}
          onClose={() => setEditing(null)}
          onSaved={criteriaSaved}
        />
      )}
    </section>
  );
}
