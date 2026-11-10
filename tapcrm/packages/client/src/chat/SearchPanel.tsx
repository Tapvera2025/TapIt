import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon } from '../ui/index.js';
import {
  getChatColleagues,
  getConversations,
  searchMessages,
  type Conversation,
  type ConversationKind,
  type SearchResult,
  type SearchType,
} from './api/chatApi.js';
import { FileBadge } from './attachments.js';
import { Avatar } from './Avatar.js';
import { whereSent } from './conversationLabel.js';
import { toPlainText } from './markdown.js';

const TYPES: readonly { value: SearchType | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'document', label: 'Docs' },
  { value: 'spreadsheet', label: 'Sheets' },
  { value: 'presentation', label: 'Slides' },
  { value: 'file', label: 'Any file' },
  { value: 'link', label: 'Links' },
];

const KIND_LABEL: Record<ConversationKind, string> = { direct: 'Direct', group: 'Group', project: 'Project' };

const OPEN = '\uE000';
const CLOSE = '\uE001';
const MARKED = /(\uE000[^\uE001]*\uE001)/g;

/** ⟦term⟧ markers from the server become <mark>; everything stays text (no HTML from the server). */
function Snippet({ text }: { text: string }): React.JSX.Element {
  // Private-use characters stand in for the markers while the text loses its formatting.
  const parts = toPlainText(text.replace(/⟦/g, OPEN).replace(/⟧/g, CLOSE)).split(MARKED);
  return (
    <>
      {parts.map((part, index) => (part.startsWith(OPEN)
        ? <mark key={index} className="rounded bg-[#fde68a] px-0.5 text-[#111827]">{part.slice(1, -1)}</mark>
        : <span key={index}>{part}</span>))}
    </>
  );
}

function dateInput(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const date = endOfDay ? new Date(year, month - 1, day + 1) : new Date(year, month - 1, day);
  return date.toISOString();
}

/**
 * Full-text search across every conversation the viewer belongs to, with
 * filters for conversation, sender, date range and media type. Results
 * open the conversation at the message, loading the history around it.
 */
export function SearchPanel({
  currentUserId,
  onOpen,
  onClose,
}: {
  currentUserId: string;
  onOpen: (result: { conversationId: string; messageId: string; kind: ConversationKind }) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<SearchType | ''>('');
  const [conversationId, setConversationId] = useState('');
  const [senderId, setSenderId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [people, setPeople] = useState<{ id: string; fullName: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    void getConversations().then(setConversations).catch(() => setConversations([]));
    void getChatColleagues().then(setPeople).catch(() => setPeople([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const filters = useMemo(() => ({
    q: debounced || undefined,
    type: type || undefined,
    conversationId: conversationId || undefined,
    senderId: senderId || undefined,
    from: dateInput(from, false),
    to: dateInput(to, true),
  }), [debounced, type, conversationId, senderId, from, to]);
  const active = Boolean(filters.q || filters.type || filters.conversationId || filters.senderId || filters.from || filters.to);
  const filterCount = [conversationId, senderId, from, to].filter(Boolean).length;

  useEffect(() => {
    if (!active) {
      setResults([]);
      setCursor(null);
      setError('');
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    searchMessages({ ...filters, limit: 20 })
      .then((page) => {
        if (id !== requestId.current) return;
        setResults(page.results);
        setCursor(page.nextCursor);
        setError('');
      })
      .catch((cause: unknown) => {
        if (id === requestId.current) setError(cause instanceof Error ? cause.message : 'Search failed.');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [active, filters]);

  const loadMore = async (): Promise<void> => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await searchMessages({ ...filters, cursor, limit: 20 });
      setResults((current) => [...current, ...page.results]);
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  };

  const conversationName = (conversation: Conversation): string => conversation.kind === 'direct'
    ? (conversation.members.find((m) => m.userId !== currentUserId)?.fullName ?? 'Direct message')
    : (conversation.name ?? 'Group');

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <div className="flex items-center gap-2 border-b border-app-border p-3">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-app-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search messages and files"
            aria-label="Search messages"
            className="h-10 w-full rounded-xl border border-app-border bg-app-background pl-9 pr-3 text-sm outline-none focus:border-app-accent"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((value) => !value)}
          className={`relative grid size-10 shrink-0 place-items-center rounded-xl border ${showFilters || filterCount > 0 ? 'border-app-accent text-app-accent' : 'border-app-border text-app-muted'} hover:border-app-accent`}
          aria-label="Filters"
          aria-expanded={showFilters}
        >
          <Icon name="filter" className="size-4" />
          {filterCount > 0 && <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-app-accent text-[9px] font-bold text-app-on-accent">{filterCount}</span>}
        </button>
        <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-xl text-app-muted hover:bg-app-surface-raised" aria-label="Close search">
          <Icon name="close" className="size-4" />
        </button>
      </div>

      <div data-lenis-prevent className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-app-border px-3 py-2">
        {TYPES.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => setType(option.value)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${type === option.value ? 'border-app-accent bg-app-accent/10 text-app-accent' : 'border-app-border text-app-muted hover:border-app-accent'}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {showFilters && (
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-app-border p-3 text-xs">
          <label className="col-span-2 flex flex-col gap-1">
            <span className="font-semibold text-app-muted">In conversation</span>
            <select value={conversationId} onChange={(event) => setConversationId(event.target.value)} className="h-9 rounded-lg border border-app-border bg-app-background px-2 text-sm">
              <option value="">Any conversation</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>{conversationName(conversation)} · {KIND_LABEL[conversation.kind]}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="font-semibold text-app-muted">From</span>
            <select value={senderId} onChange={(event) => setSenderId(event.target.value)} className="h-9 rounded-lg border border-app-border bg-app-background px-2 text-sm">
              <option value="">Anyone</option>
              <option value={currentUserId}>Me</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-app-muted">After</span>
            <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-lg border border-app-border bg-app-background px-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-app-muted">Before</span>
            <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-lg border border-app-border bg-app-background px-2 text-sm" />
          </label>
          {filterCount > 0 && (
            <button type="button" onClick={() => { setConversationId(''); setSenderId(''); setFrom(''); setTo(''); }} className="col-span-2 justify-self-start text-xs font-semibold text-app-accent hover:underline">
              Clear filters
            </button>
          )}
        </div>
      )}

      <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {!active ? (
          <div className="px-4 py-10 text-center text-sm text-app-muted">
            <Icon name="search" className="mx-auto mb-2 size-8 opacity-50" />
            Search every conversation you are in — words, names, codes and file names.
            <p className="mt-1 text-xs">Tip: “quoted phrase”, -exclude, or pick a type above to browse files.</p>
          </div>
        ) : error ? (
          <p className="px-4 py-6 text-center text-sm text-app-danger">{error}</p>
        ) : results.length === 0 && !loading ? (
          <p className="px-4 py-10 text-center text-sm text-app-muted">No messages match.</p>
        ) : (
          <ul className="space-y-1">
            {results.map((result) => (
              <li key={result.messageId}>
                <button
                  type="button"
                  onClick={() => onOpen({ conversationId: result.conversationId, messageId: result.messageId, kind: result.conversationKind })}
                  className="flex w-full gap-2.5 rounded-xl p-2.5 text-left hover:bg-app-surface-raised"
                >
                  <Avatar name={result.senderName} seed={result.senderId} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs">
                        <span className="font-semibold text-app-foreground">{result.senderId === currentUserId ? 'You' : result.senderName}</span>
                        <span className="text-app-muted">{whereSent(result.conversationKind, result.conversationLabel, result.senderId === currentUserId)}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-app-muted">
                        {new Date(result.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', ...(new Date(result.createdAt).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}
                      </span>
                    </span>
                    {result.snippet && <span className="mt-0.5 line-clamp-3 block text-sm text-app-foreground"><Snippet text={result.snippet} /></span>}
                    {result.attachments.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {result.attachments.slice(0, 3).map((file) => (
                          <span key={file.id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-app-border bg-app-surface px-1.5 py-0.5 text-[11px]">
                            <FileBadge kind={file.kind} fileName={file.fileName} className="size-4 !text-[6px]" />
                            <span className="truncate">{file.fileName}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {loading && <p className="py-3 text-center text-xs text-app-muted">Searching…</p>}
        {cursor && !loading && (
          <div className="py-2 text-center">
            <Button kind="secondary" onClick={() => void loadMore()} className="!px-3 !py-1.5 !text-xs">Load more results</Button>
          </div>
        )}
      </div>
    </div>
  );
}
