import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Card, Field, Icon, Modal, Notice, Progress, Select, Skeleton, SkeletonDetail } from '../../../ui/index.js';
import { LiquidGlassTabs } from '../../recruitment/components/RecruitmentTabs.js';
import { getCall, getCallRecording, type CallDetail, type CallListItem, type CallOverview, type ConnectionSummary, type DailyCallPoint } from './api.js';
import {
  axisLabelEvery,
  directionLabel,
  formatCallTime,
  formatDay,
  formatDuration,
  formatPhone,
  OUTCOME_LABELS,
  outcomeTone,
  presetRange,
  PROVIDER_NAMES,
  RANGE_LABELS,
  timeAgo,
  type RangePreset,
} from './calls-format.js';

/* ==================================================================== *
 * Navigation
 * ==================================================================== */

export type CallsTab = 'team' | 'mine' | 'log' | 'assigned' | 'integrations';

export const CALLS_PATHS: Readonly<Record<CallsTab, string>> = {
  team: '/company/sales/calls',
  mine: '/company/sales/calls/me',
  log: '/company/sales/calls/log',
  assigned: '/company/sales/calls/assigned-leads',
  integrations: '/company/sales/call-integrations',
};

export interface CallsAccess {
  /** Sees more than their own calls (team, pool, department or everyone). */
  readonly canSeeTeam: boolean;
  readonly canListen: boolean;
  readonly canManage: boolean;
  /** Sees calls at all (telephony:view). Left out, assumed. */
  readonly canViewCalls?: boolean;
  /** Sees whether imported leads were called by their assignees (lead-imports:view). */
  readonly canTrackAssigned?: boolean;
}

export function CallsTabs({ active, access, onNavigate }: { active: CallsTab; access: CallsAccess; onNavigate: (path: string) => void }): React.JSX.Element {
  const items = [
    ...(access.canSeeTeam ? [{ id: 'team', label: 'Team calls', path: CALLS_PATHS.team, iconName: 'users' }] : []),
    ...(access.canViewCalls !== false
      ? [
          { id: 'mine', label: 'My calls', path: CALLS_PATHS.mine, iconName: 'phone' },
          { id: 'log', label: 'Call log', path: CALLS_PATHS.log, iconName: 'history' },
        ]
      : []),
    ...(access.canTrackAssigned ? [{ id: 'assigned', label: 'Assigned leads', path: CALLS_PATHS.assigned, iconName: 'user-plus' }] : []),
    ...(access.canManage ? [{ id: 'integrations', label: 'Integrations', path: CALLS_PATHS.integrations, iconName: 'settings' }] : []),
  ];
  return <LiquidGlassTabs items={items} activeId={active} onNavigate={onNavigate} ariaLabel="Call analytics sections" />;
}

/* ==================================================================== *
 * Filters
 * ==================================================================== */

export interface RangeValue {
  readonly preset: RangePreset;
  readonly from: string;
  readonly to: string;
}

export function initialRange(timeZone: string, preset: Exclude<RangePreset, 'custom'> = '30d'): RangeValue {
  return { preset, ...presetRange(preset, timeZone) };
}

const PRESETS: ReadonlyArray<Exclude<RangePreset, 'custom'>> = ['today', '7d', '30d', 'month', '90d'];

export function RangeFilter({ value, timeZone, onChange }: { value: RangeValue; timeZone: string; onChange: (next: RangeValue) => void }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end">
      <div role="group" aria-label="Date range" className="flex flex-wrap gap-1.5 rounded-xl border border-app-border bg-app-surface p-1">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={value.preset === preset}
            onClick={() => onChange({ preset, ...presetRange(preset, timeZone) })}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              value.preset === preset ? 'ui-primary' : 'text-app-muted hover:bg-app-background hover:text-app-foreground'
            }`}
          >
            {RANGE_LABELS[preset]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:w-80">
        <Field label="From" type="date" value={value.from} onChange={(from) => from && onChange({ preset: 'custom', from, to: value.to < from ? from : value.to })} />
        <Field label="To" type="date" value={value.to} min={value.from} onChange={(to) => to && onChange({ preset: 'custom', from: value.from > to ? to : value.from, to })} />
      </div>
    </div>
  );
}

export function ProviderSelect({ value, onChange }: { value: string; onChange: (value: string) => void }): React.JSX.Element {
  return (
    <Select
      label="Platform"
      value={value}
      onChange={onChange}
      placeholder="All platforms"
      options={[
        { value: 'justcall', label: 'JustCall' },
        { value: 'aircall', label: 'Aircall' },
      ]}
    />
  );
}

export function DirectionSelect({ value, onChange }: { value: string; onChange: (value: string) => void }): React.JSX.Element {
  return (
    <Select
      label="Direction"
      value={value}
      onChange={onChange}
      placeholder="Both directions"
      options={[
        { value: 'inbound', label: 'Incoming' },
        { value: 'outbound', label: 'Outgoing' },
      ]}
    />
  );
}

/* ==================================================================== *
 * Headline numbers
 * ==================================================================== */

export interface StatItem {
  readonly label: string;
  readonly value: string;
  readonly hint?: string | undefined;
  readonly icon: string;
  readonly tone?: 'default' | 'success' | 'danger' | 'accent';
}

const STAT_TONES: Readonly<Record<NonNullable<StatItem['tone']>, string>> = {
  default: 'bg-app-accent/10 text-app-accent',
  accent: 'bg-app-accent/10 text-app-accent',
  success: 'bg-app-success/10 text-app-success',
  danger: 'bg-app-danger/10 text-app-danger',
};

export function StatGrid({ items }: { items: readonly StatItem[] }): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="ui-card flex min-h-[124px] flex-col p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-app-muted">{item.label}</p>
            <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${STAT_TONES[item.tone ?? 'default']}`}>
              <Icon name={item.icon} className="size-4" />
            </span>
          </div>
          <p className="mt-auto pt-3 text-2xl font-bold tabular-nums tracking-tight">{item.value}</p>
          {item.hint && <p className="mt-0.5 truncate text-xs text-app-muted">{item.hint}</p>}
        </div>
      ))}
    </div>
  );
}

export function StatGridSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" role="status" aria-label="Loading call numbers">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="ui-card min-h-[124px] p-4">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="mt-8 h-7 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/* ==================================================================== *
 * Charts — the shared chart look (chart-glass, chart-bar), two series.
 * ==================================================================== */

export function DailyCallsChart({ points }: { points: readonly DailyCallPoint[] }): React.JSX.Element {
  const max = Math.max(1, ...points.map((point) => point.inbound + point.outbound));
  const every = axisLabelEvery(points.length);
  const empty = points.every((point) => point.inbound + point.outbound === 0);
  return (
    <div className="flex min-h-[300px] flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-app-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-app-accent" />Incoming</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-app-accent/30" />Outgoing</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full bg-app-danger" />Missed</span>
      </div>
      <div role="img" aria-label="Calls per day, incoming and outgoing" className="chart-glass relative flex min-h-0 flex-1 rounded-2xl border border-app-border p-3">
        <div className="pointer-events-none absolute inset-x-3 top-3 bottom-9 flex flex-col justify-between" aria-hidden="true">
          {[0, 1, 2, 3].map((line) => <div key={line} className="border-t border-dashed border-app-border" />)}
        </div>
        {empty ? (
          <p className="relative m-auto text-sm text-app-muted">No calls in this period.</p>
        ) : (
          <div className="relative flex min-w-0 flex-1 items-end gap-[3px] pb-6">
            {points.map((point, index) => {
              const total = point.inbound + point.outbound;
              const height = (total / max) * 100;
              return (
                <div
                  key={point.day}
                  className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                  title={`${formatDay(point.day)}: ${point.inbound} incoming, ${point.outbound} outgoing, ${point.missed} missed, ${formatDuration(point.talkSeconds)} talk time`}
                >
                  {point.missed > 0 && <span className="mb-1 size-1.5 rounded-full bg-app-danger" aria-hidden="true" />}
                  <div
                    className="flex w-full max-w-7 origin-bottom flex-col overflow-hidden rounded-t-md transition-[height] duration-500 group-hover:brightness-110"
                    style={{ height: `${Math.max(height, total ? 2 : 0)}%`, animation: 'bar-enter 650ms cubic-bezier(0.2, 0.7, 0.2, 1) both', animationDelay: `${index * 12}ms` }}
                  >
                    <div className="w-full basis-0 bg-app-accent/30" style={{ flexGrow: point.outbound }} />
                    <div className="w-full basis-0 bg-app-accent" style={{ flexGrow: point.inbound }} />
                  </div>
                  {index % every === 0 && (
                    <span className="absolute -bottom-6 w-max text-[10px] text-app-muted">{formatDay(point.day)}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.day}>{`${point.day}: ${point.inbound} incoming, ${point.outbound} outgoing, ${point.missed} missed`}</li>
        ))}
      </ul>
    </div>
  );
}

export function HourlyStrip({ hourly }: { hourly: CallOverview['hourly'] }): React.JSX.Element {
  const byHour = new Map(hourly.map((item) => [item.hour, item.calls]));
  const max = Math.max(1, ...hourly.map((item) => item.calls));
  const busiest = [...hourly].sort((a, b) => b.calls - a.calls)[0];
  return (
    <div>
      <div className="grid grid-cols-12 gap-1 sm:grid-cols-24" role="img" aria-label="Calls by hour of day">
        {Array.from({ length: 24 }, (_, hour) => {
          const calls = byHour.get(hour) ?? 0;
          return (
            <div key={hour} className="flex flex-col items-center gap-1" title={`${String(hour).padStart(2, '0')}:00 — ${calls} calls`}>
              <div
                className="h-10 w-full rounded-md border border-app-border"
                style={{ background: calls ? `color-mix(in srgb, var(--theme-primary) ${Math.round(12 + (calls / max) * 78)}%, transparent)` : undefined }}
              />
              <span className="text-[9px] tabular-nums text-app-muted">{hour % 3 === 0 ? hour : ''}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-app-muted">
        {busiest && busiest.calls > 0 ? `Busiest hour: ${String(busiest.hour).padStart(2, '0')}:00 (${busiest.calls} calls)` : 'No calls yet in this period.'}
      </p>
    </div>
  );
}

export function OutcomeBreakdown({ outcomes, total }: { outcomes: CallOverview['outcomes']; total: number }): React.JSX.Element {
  if (!outcomes.length) return <p className="text-sm text-app-muted">No calls in this period.</p>;
  return (
    <div className="space-y-3">
      {outcomes.map((item) => (
        <Progress key={item.outcome} label={OUTCOME_LABELS[item.outcome]} value={item.calls} max={total} />
      ))}
    </div>
  );
}

/* ==================================================================== *
 * Calls
 * ==================================================================== */

export function OutcomePill({ outcome }: { outcome: CallListItem['outcome'] }): React.JSX.Element {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${outcomeTone(outcome)}`}>
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

export function DirectionIcon({ call }: { call: Pick<CallListItem, 'direction' | 'outcome'> }): React.JSX.Element {
  const missed = call.outcome !== 'answered' && call.outcome !== 'other';
  const name = missed && call.direction === 'inbound' ? 'phone-missed' : call.direction === 'inbound' ? 'phone-incoming' : 'phone-outgoing';
  return (
    <span
      className={`grid size-9 shrink-0 place-items-center rounded-xl ${missed ? 'bg-app-danger/10 text-app-danger' : 'bg-app-accent/10 text-app-accent'}`}
      title={`${directionLabel(call.direction)} · ${OUTCOME_LABELS[call.outcome]}`}
    >
      <Icon name={name} className="size-4" />
    </span>
  );
}

export function CallsTable({
  calls,
  timeZone,
  onOpen,
  showEmployee = true,
  emptyText = 'No calls match these filters.',
}: {
  calls: readonly CallListItem[];
  timeZone: string;
  onOpen: (callId: string) => void;
  showEmployee?: boolean;
  emptyText?: string;
}): React.JSX.Element {
  if (calls.length === 0) {
    return (
      <div className="grid place-items-center gap-2 px-6 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-app-accent/10 text-app-accent"><Icon name="phone" className="size-5" /></span>
        <p className="text-sm text-app-muted">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-app-border text-left text-[11px] font-bold uppercase tracking-wider text-app-muted">
            <th className="px-4 py-3">Call</th>
            <th className="px-4 py-3">Contact</th>
            {showEmployee && <th className="px-4 py-3">Employee</th>}
            <th className="px-4 py-3">Result</th>
            <th className="px-4 py-3 text-right">Talk time</th>
            <th className="px-4 py-3 text-right"><span className="sr-only">Recording</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border">
          {calls.map((call) => (
            <tr key={call.id} className="cursor-pointer transition hover:bg-app-background/70" onClick={() => onOpen(call.id)}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <DirectionIcon call={call} />
                  <div className="min-w-0">
                    <p className="font-semibold">{formatCallTime(call.startedAt, timeZone)}</p>
                    <p className="text-xs text-app-muted">{directionLabel(call.direction)} · {PROVIDER_NAMES[call.provider]}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  className="text-left"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(call.id);
                  }}
                >
                  <span className="block font-semibold">{call.contactName ?? formatPhone(call.contactNumber)}</span>
                  <span className="block text-xs text-app-muted">{call.contactName ? formatPhone(call.contactNumber) : (call.businessNumberName ?? '')}</span>
                </button>
              </td>
              {showEmployee && (
                <td className="px-4 py-3">
                  {call.employeeName ? (
                    <>
                      <span className="block font-semibold">{call.employeeName}</span>
                      <span className="block text-xs text-app-muted">{call.teamName ?? 'No team'}</span>
                    </>
                  ) : (
                    <>
                      <span className="block font-semibold text-app-muted">{call.agentName ?? 'Unknown user'}</span>
                      <span className="block text-xs text-app-danger">Not matched to an employee</span>
                    </>
                  )}
                </td>
              )}
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <OutcomePill outcome={call.outcome} />
                  {call.disposition && <span className="truncate text-xs text-app-muted">{call.disposition}</span>}
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                <span className="font-semibold">{formatDuration(call.talkSeconds)}</span>
                <span className="block text-xs text-app-muted">of {formatDuration(call.durationSeconds)}</span>
              </td>
              <td className="px-4 py-3 text-right">
                {(call.hasRecording || call.hasVoicemail) && (
                  <span className="inline-grid size-8 place-items-center rounded-lg bg-app-accent/10 text-app-accent" title={call.hasVoicemail ? 'Voicemail' : 'Recording'}>
                    <Icon name={call.hasVoicemail ? 'voicemail' : 'play'} className="size-3.5" />
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="divide-y divide-app-border" role="status" aria-label="Loading calls">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex-1">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-app-border py-2 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-app-muted">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

function RecordingPlayer({ callId, voicemail }: { callId: string; voicemail: boolean }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const blob = await getCallRecording(callId);
      setUrl(URL.createObjectURL(blob));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The recording could not be loaded.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="rounded-xl border border-app-border bg-app-surface-raised p-3">
      {url ? (
        <audio controls autoPlay src={url} className="w-full" aria-label={voicemail ? 'Voicemail' : 'Call recording'} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Icon name={voicemail ? 'voicemail' : 'play'} className="size-4 text-app-accent" />
            <span className="font-semibold">{voicemail ? 'Voicemail' : 'Call recording'}</span>
            <span className="text-xs text-app-muted">Fetched securely; every play is logged.</span>
          </div>
          <Button kind="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : voicemail ? 'Play voicemail' : 'Play recording'}
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-app-danger" role="alert">{error}</p>}
    </div>
  );
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

export function CallDetailModal({
  callId,
  timeZone,
  canListen,
  onClose,
  onOpenEmployee,
}: {
  callId: string;
  timeZone: string;
  canListen: boolean;
  onClose: () => void;
  onOpenEmployee?: ((employeeId: string) => void) | undefined;
}): React.JSX.Element {
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCall(callId)
      .then((detail) => {
        if (!cancelled) setCall(detail);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load this call.');
      });
    return () => {
      cancelled = true;
    };
  }, [callId]);

  const extras = useMemo(() => {
    if (!call) return [];
    const meta = call.metadata;
    const rows: Array<[string, string]> = [];
    const transcript = asText(meta['voicemailTranscription']);
    if (transcript) rows.push(['Voicemail transcript', transcript]);
    const traits = Array.isArray(meta['callTraits']) ? (meta['callTraits'] as unknown[]).map(asText).filter(Boolean).join(', ') : null;
    if (traits) rows.push(['Call path', traits]);
    const teams = Array.isArray(meta['teams']) ? (meta['teams'] as unknown[]).map(asText).filter(Boolean).join(', ') : null;
    if (teams) rows.push(['Platform team', teams]);
    return rows;
  }, [call]);

  return (
    <Modal title={call ? (call.contactName ?? formatPhone(call.contactNumber)) : 'Call'} onClose={onClose} size="lg">
      {error && <Notice error>{error}</Notice>}
      {!call && !error && <SkeletonDetail sections={2} />}
      {call && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <DirectionIcon call={call} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {directionLabel(call.direction)} call · {formatCallTime(call.startedAt, timeZone)}
              </p>
              <p className="text-xs text-app-muted">
                {[PROVIDER_NAMES[call.provider], call.connectionLabel !== PROVIDER_NAMES[call.provider] ? call.connectionLabel : null, call.businessNumberName]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <OutcomePill outcome={call.outcome} />
          </div>

          {canListen && (call.hasRecording || call.hasVoicemail) && <RecordingPlayer callId={call.id} voicemail={call.hasVoicemail} />}

          {call.aiSummary && (
            <section className="rounded-xl border border-app-accent/25 bg-app-accent/5 p-4">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-app-accent">
                <Icon name="sparkles" className="size-4" /> AI summary
                {call.aiSentiment && <span className="ml-auto normal-case tracking-normal text-app-muted">Sentiment: {call.aiSentiment}</span>}
              </p>
              <p className="mt-2 whitespace-pre-line text-sm leading-6">{call.aiSummary}</p>
            </section>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <dl>
              <DetailRow label="Contact">{formatPhone(call.contactNumber)}</DetailRow>
              {call.contactEmail && <DetailRow label="Email">{call.contactEmail}</DetailRow>}
              <DetailRow label="Business line">{call.businessNumber ? formatPhone(call.businessNumber) : '—'}</DetailRow>
              <DetailRow label="Employee">
                {call.employeeId && call.employeeName ? (
                  onOpenEmployee ? (
                    <button type="button" className="font-semibold text-app-accent hover:underline" onClick={() => call.employeeId && onOpenEmployee(call.employeeId)}>
                      {call.employeeName}
                    </button>
                  ) : (
                    call.employeeName
                  )
                ) : (
                  <span className="text-app-danger">{call.agentName ?? 'Unknown'} (not matched)</span>
                )}
              </DetailRow>
              {call.teamName && <DetailRow label="Team">{call.teamName}</DetailRow>}
              {call.disposition && <DetailRow label="Disposition">{call.disposition}</DetailRow>}
              {call.missedReason && <DetailRow label="Missed because">{call.missedReason.replace(/_/g, ' ')}</DetailRow>}
              {call.rating !== null && <DetailRow label="Rating">{call.rating} / 5</DetailRow>}
              {call.aiScore !== null && <DetailRow label="AI call score">{call.aiScore}</DetailRow>}
            </dl>
            <dl>
              <DetailRow label="Total duration">{formatDuration(call.durationSeconds)}</DetailRow>
              <DetailRow label="Talk time">{formatDuration(call.talkSeconds)}</DetailRow>
              {call.ringSeconds !== null && <DetailRow label="Ringing">{formatDuration(call.ringSeconds)}</DetailRow>}
              {call.queueWaitSeconds !== null && <DetailRow label="Queue wait">{formatDuration(call.queueWaitSeconds)}</DetailRow>}
              {call.holdSeconds !== null && <DetailRow label="On hold">{formatDuration(call.holdSeconds)}</DetailRow>}
              {call.wrapUpSeconds !== null && <DetailRow label="Wrap-up">{formatDuration(call.wrapUpSeconds)}</DetailRow>}
              <DetailRow label="Synced">{timeAgo(call.lastSyncedAt)}</DetailRow>
            </dl>
          </div>

          {call.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {call.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-app-border bg-app-surface-raised px-2.5 py-0.5 text-xs font-semibold">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {call.notes && (
            <section>
              <p className="text-xs font-bold uppercase tracking-wider text-app-muted">Notes</p>
              <p className="mt-1 whitespace-pre-line rounded-xl border border-app-border bg-app-surface-raised p-3 text-sm leading-6">{call.notes}</p>
            </section>
          )}

          {extras.length > 0 && (
            <dl>
              {extras.map(([label, value]) => (
                <DetailRow key={label} label={label}>
                  <span className="whitespace-pre-line">{value}</span>
                </DetailRow>
              ))}
            </dl>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ==================================================================== *
 * Empty and status states
 * ==================================================================== */

export function NoIntegration({ canManage, onNavigate }: { canManage: boolean; onNavigate: (path: string) => void }): React.JSX.Element {
  return (
    <Card className="grid place-items-center gap-4 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-app-accent/10 text-app-accent">
        <Icon name="phone" className="size-6" />
      </span>
      <div className="max-w-md">
        <h2 className="font-display text-xl font-bold">No calling platform connected yet</h2>
        <p className="mt-2 text-sm text-app-muted">
          {canManage
            ? 'Connect JustCall or Aircall with an API key. Calls sync every 15 minutes and land on each employee by their email.'
            : 'Ask your administrator to connect JustCall or Aircall. Your calls will appear here once it is set up.'}
        </p>
      </div>
      {canManage && <Button onClick={() => onNavigate(CALLS_PATHS.integrations)}>Connect a platform</Button>}
    </Card>
  );
}

export function SyncFootnote({ connections }: { connections: readonly ConnectionSummary[] }): React.JSX.Element | null {
  if (!connections.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-app-muted">
      {connections.map((connection) => (
        <span key={connection.id} className="inline-flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${connection.status === 'active' ? 'bg-app-success' : connection.status === 'error' ? 'bg-app-danger' : 'bg-app-muted'}`} />
          {PROVIDER_NAMES[connection.provider]} synced {timeAgo(connection.lastSyncFinishedAt)}
        </span>
      ))}
    </p>
  );
}

export function SectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-app-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
