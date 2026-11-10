import { Icon } from '../ui/index.js';
import {
  ASSET_LABELS,
  STATUS_LABELS,
  type SocialCompanyAssetPlatform,
  type SocialPostStatus,
} from './types.js';

const platformStyle: Record<SocialCompanyAssetPlatform, string> = {
  facebook: 'bg-blue-600 text-white',
  instagram: 'bg-fuchsia-600 text-white',
  linkedin: 'bg-sky-700 text-white',
  google_business: 'bg-emerald-600 text-white',
  youtube: 'bg-red-600 text-white',
  search_console: 'bg-amber-600 text-white',
};
const platformShort: Record<SocialCompanyAssetPlatform, string> = {
  facebook: 'f',
  instagram: '◎',
  linkedin: 'in',
  google_business: 'G',
  youtube: '▶',
  search_console: 'SC',
};
export function PlatformMark({
  platform,
  small = false,
}: {
  platform: SocialCompanyAssetPlatform;
  small?: boolean;
}): React.JSX.Element {
  return (
    <span
      title={ASSET_LABELS[platform]}
      aria-label={ASSET_LABELS[platform]}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-bold ${small ? 'size-6 text-xs' : 'size-10 text-lg'} ${platformStyle[platform]}`}
    >
      {platformShort[platform]}
    </span>
  );
}
export function PostStatus({ status }: { status: string }): React.JSX.Element {
  const tone = ['published', 'approved', 'connected', 'active'].includes(status)
    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
    : [
          'failed',
          'disconnected',
          'expired',
          'revoked',
          'reconnect_required',
          'outcome_unknown',
        ].includes(status)
      ? 'bg-red-500/12 text-app-danger'
      : ['scheduled', 'publishing'].includes(status)
        ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300'
        : ['pending_approval', 'partially_published'].includes(status)
          ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
          : 'bg-app-surface-raised text-app-muted';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}
    >
      {STATUS_LABELS[status as SocialPostStatus] ?? status.replaceAll('_', ' ')}
    </span>
  );
}
export function SocialEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-app-accent/10 text-app-accent">
        <Icon name="share" className="size-6" />
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-app-muted">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
export function socialDate(value: string | null | undefined, timezone: string): string {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}
export function dateInZone(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
