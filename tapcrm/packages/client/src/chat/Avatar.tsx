import type { ChatPresence } from './api/chatApi.js';
import { PRESENCE_LABEL } from './presence.js';

const PALETTE = ['#0ea5e9', '#8b5cf6', '#f97316', '#14b8a6', '#ec4899', '#6366f1', '#84cc16', '#ef4444', '#06b6d4', '#a855f7'];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0]!)[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const SIZES = {
  xs: { box: 'size-6 text-[10px]', dot: 'size-2 ring-[1.5px]' },
  sm: { box: 'size-8 text-[11px]', dot: 'size-2.5 ring-2' },
  md: { box: 'size-10 text-xs', dot: 'size-3 ring-2' },
} as const;

const DOT_COLOR: Record<ChatPresence, string> = {
  active: 'bg-[#22c55e]',
  idle: 'bg-[#f59e0b]',
  offline: 'bg-[#9ca3af]',
};

/** A person's initials on a stable colour, with the live-status dot when presence is known. */
export function Avatar({
  name,
  seed,
  presence,
  size = 'sm',
  className = '',
}: {
  name: string;
  /** Stable colour key — the user id. */
  seed: string;
  presence?: ChatPresence | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}): React.JSX.Element {
  const dims = SIZES[size];
  return (
    <span className={`relative inline-grid shrink-0 ${className}`} title={presence ? `${name} · ${PRESENCE_LABEL[presence]}` : name}>
      <span
        className={`grid ${dims.box} place-items-center rounded-full font-bold text-white`}
        style={{ backgroundColor: colorFor(seed) }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      {presence && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-app-surface ${dims.dot} ${DOT_COLOR[presence]}`}
          role="img"
          aria-label={PRESENCE_LABEL[presence]}
        />
      )}
    </span>
  );
}

/** "Active" / "On a break" / "Offline", with the matching dot — for a DM's header. */
export function PresenceLabel({ presence }: { presence: ChatPresence }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-app-muted">
      <span className={`size-2 rounded-full ${DOT_COLOR[presence]}`} aria-hidden="true" />
      {PRESENCE_LABEL[presence]}
    </span>
  );
}

/** A group/project conversation's badge (no presence: it is not a person). */
export function GroupAvatar({ name, seed, size = 'sm' }: { name: string; seed: string; size?: keyof typeof SIZES }): React.JSX.Element {
  return (
    <span
      className={`grid shrink-0 ${SIZES[size].box} place-items-center rounded-xl font-bold text-white`}
      style={{ backgroundColor: colorFor(seed) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
