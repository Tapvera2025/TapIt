import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../ui/index.js';

/**
 * Full Unicode emoji picker: search by name and keyword, categories,
 * recently used, skin tones. The data (≈1,900 emoji, Unicode ≤ 15.0, ~45 KB
 * gzipped) is a separate chunk loaded the first time a picker opens.
 */

interface EmojiEntry {
  readonly emoji: string;
  readonly name: string;
  readonly keywords: string;
  readonly group: number;
  readonly skins: readonly string[] | null;
}

interface EmojiData {
  readonly groups: readonly string[];
  readonly entries: readonly EmojiEntry[];
}

type RawRow = [string, string, string, number, string[]?];

let cached: Promise<EmojiData> | null = null;

export function loadEmojiData(): Promise<EmojiData> {
  cached ??= import('./emoji-data.json').then((module) => {
    const raw = (module as unknown as { default: { groups: string[]; emoji: RawRow[] } }).default;
    return {
      groups: raw.groups,
      entries: raw.emoji.map(([emoji, name, keywords, group, skins]) => ({ emoji, name, keywords, group, skins: skins ?? null })),
    };
  });
  return cached;
}

const GROUP_ICONS = ['😀', '👋', '🐶', '🍔', '✈️', '⚽', '💡', '❤️', '🏁'];
const TONE_SAMPLES = ['👋', '👋🏻', '👋🏼', '👋🏽', '👋🏾', '👋🏿'];
const RECENT_KEY = 'tapcrm.chat.recent-emoji';
const TONE_KEY = 'tapcrm.chat.emoji-tone';
const MAX_RECENT = 24;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / storage blocked: recents just are not remembered */
  }
}

export function recentEmoji(): string[] {
  try {
    const parsed = JSON.parse(readStored(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): void {
  writeStored(RECENT_KEY, JSON.stringify([emoji, ...recentEmoji().filter((value) => value !== emoji)].slice(0, MAX_RECENT)));
}

function withTone(entry: EmojiEntry, tone: number): string {
  return tone > 0 && entry.skins ? (entry.skins[tone - 1] ?? entry.emoji) : entry.emoji;
}

function matches(entry: EmojiEntry, terms: readonly string[]): boolean {
  const haystack = ` ${entry.name.toLowerCase()} ${entry.keywords} `;
  return terms.every((term) => haystack.includes(` ${term}`) || haystack.includes(term));
}

/** The picker body (search + grid). Rendered inside EmojiPopover, or anywhere a panel is needed. */
export function EmojiPicker({ onSelect, onClose, autoFocus = true }: { onSelect: (emoji: string) => void; onClose?: () => void; autoFocus?: boolean }): React.JSX.Element {
  const [data, setData] = useState<EmojiData | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [tone, setTone] = useState(() => Number(readStored(TONE_KEY) ?? 0) || 0);
  const [showTones, setShowTones] = useState(false);
  const [recents] = useState(recentEmoji);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    let alive = true;
    loadEmojiData().then((loaded) => alive && setData(loaded)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (autoFocus) searchRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => (data && terms.length > 0 ? data.entries.filter((entry) => matches(entry, terms)).slice(0, 160) : []), [data, terms]);

  const pick = (emoji: string): void => {
    rememberEmoji(emoji);
    onSelect(emoji);
  };

  const chooseTone = (next: number): void => {
    setTone(next);
    setShowTones(false);
    writeStored(TONE_KEY, String(next));
  };

  const cell = (entry: EmojiEntry) => {
    const value = withTone(entry, tone);
    return (
      <button
        key={entry.emoji}
        type="button"
        onClick={() => pick(value)}
        title={entry.name}
        aria-label={entry.name}
        className="grid aspect-square place-items-center rounded-lg text-[22px] leading-none transition-transform hover:scale-110 hover:bg-app-surface-raised focus-visible:bg-app-surface-raised focus-visible:outline-2 focus-visible:outline-app-accent"
      >
        {value}
      </button>
    );
  };

  return (
    <div data-chat-popover className="flex h-full min-h-0 w-full flex-col" onKeyDown={(event) => { if (event.key === 'Escape') onClose?.(); }}>
      <div className="flex items-center gap-2 border-b border-app-border p-2">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-app-muted" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results[0]) {
                event.preventDefault();
                pick(withTone(results[0], tone));
              }
            }}
            placeholder="Search emoji"
            aria-label="Search emoji"
            className="h-9 w-full rounded-lg border border-app-border bg-app-background pl-8 pr-2 text-sm outline-none focus:border-app-accent"
          />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowTones((open) => !open)}
            className="grid size-9 place-items-center rounded-lg border border-app-border text-lg hover:border-app-accent"
            aria-label="Skin tone"
            aria-expanded={showTones}
          >
            {TONE_SAMPLES[tone]}
          </button>
          {showTones && (
            <div className="absolute right-0 top-full z-10 mt-1 flex gap-0.5 rounded-lg border border-app-border bg-app-surface p-1 shadow-lg">
              {TONE_SAMPLES.map((sample, index) => (
                <button key={sample} type="button" onClick={() => chooseTone(index)} className={`grid size-8 place-items-center rounded-md text-lg hover:bg-app-surface-raised ${index === tone ? 'bg-app-accent/15' : ''}`} aria-label={`Skin tone ${index === 0 ? 'default' : index}`}>
                  {sample}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!terms.length && data && (
        <div className="flex shrink-0 justify-between gap-0.5 border-b border-app-border px-1.5 py-1">
          {data.groups.map((group, index) => (
            <button
              key={group}
              type="button"
              title={group}
              aria-label={group}
              onClick={() => sectionRefs.current.get(index)?.scrollIntoView({ block: 'start' })}
              className="grid size-8 place-items-center rounded-md text-base opacity-75 hover:bg-app-surface-raised hover:opacity-100"
            >
              {GROUP_ICONS[index] ?? '•'}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {failed ? (
          <p className="p-4 text-center text-sm text-app-muted">Emoji could not be loaded. Check your connection.</p>
        ) : !data ? (
          <p className="p-4 text-center text-sm text-app-muted">Loading emoji…</p>
        ) : terms.length > 0 ? (
          results.length === 0 ? (
            <p className="p-4 text-center text-sm text-app-muted">No emoji match “{query}”.</p>
          ) : (
            <div className="grid grid-cols-8 gap-0.5 pt-2">{results.map(cell)}</div>
          )
        ) : (
          <>
            {recents.length > 0 && (
              <section>
                <p className="sticky top-0 z-[1] bg-app-surface py-1.5 text-[11px] font-semibold uppercase tracking-wide text-app-muted">Recently used</p>
                <div className="grid grid-cols-8 gap-0.5">
                  {recents.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => pick(emoji)} className="grid aspect-square place-items-center rounded-lg text-[22px] leading-none hover:scale-110 hover:bg-app-surface-raised" aria-label={emoji}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {data.groups.map((group, index) => (
              <section key={group} ref={(element) => { if (element) sectionRefs.current.set(index, element as HTMLDivElement); }}>
                <p className="sticky top-0 z-[1] bg-app-surface py-1.5 text-[11px] font-semibold uppercase tracking-wide text-app-muted">{group}</p>
                <div className="grid grid-cols-8 gap-0.5" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 400px' }}>
                  {data.entries.filter((entry) => entry.group === index).map(cell)}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The picker as a popover next to `anchor` (a desktop pointer) or as a
 * bottom sheet (small screens). Closes on outside click or Escape.
 */
export function EmojiPopover({ anchor, onSelect, onClose }: { anchor: DOMRect | null; onSelect: (emoji: string) => void; onClose: () => void }): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const sheet = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;
  const width = 340;
  const height = 380;

  useLayoutEffect(() => {
    if (sheet || !anchor) return;
    const below = anchor.bottom + 6;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - height - 6);
    const left = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);
    setPosition({ top, left });
  }, [anchor, sheet]);

  // Listeners are added once: re-adding them whenever the parent passes a new
  // `onClose` would drop the Escape that made the parent re-render.
  const dismiss = useEffectEvent(() => onClose());
  useEffect(() => {
    const close = (event: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) dismiss();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss();
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', escape);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  return createPortal(
    <>
      {sheet && <div className="fixed inset-0 z-[60] bg-black/40" aria-hidden="true" />}
      <div
        ref={panelRef}
        data-chat-popover
        role="dialog"
        aria-label="Emoji picker"
        className={sheet
          ? 'fixed inset-x-0 bottom-0 z-[61] h-[60vh] rounded-t-2xl border border-app-border bg-app-surface shadow-2xl'
          : 'fixed z-[61] overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-2xl'}
        style={sheet ? undefined : { top: position?.top ?? -9999, left: position?.left ?? -9999, width, height }}
      >
        <EmojiPicker onSelect={onSelect} onClose={onClose} autoFocus={!sheet} />
      </div>
    </>,
    document.body,
  );
}
