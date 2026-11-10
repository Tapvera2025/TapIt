import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_NAVIGATE_EVENT, type AppNavigateEvent } from '../navigationEvent.js';
import { getConversation, type ConversationKind } from './api/chatApi.js';
import { DirectMessagesPage } from './DirectMessagesPage.js';
import { InternalGroupsPage } from './InternalGroupsPage.js';
import { ProjectGroupsPage } from './ProjectGroupsPage.js';
import { LiquidMessagesTabBar } from './LiquidMessagesTabBar.js';
import { useChatUnread } from './ChatUnreadContext.js';
import { SavedPanel } from './SavedPanel.js';
import { SearchPanel } from './SearchPanel.js';
import { Icon, PanelSurface } from '../ui/index.js';

type Tab = 'direct' | 'group' | 'project';
const TAB_FOR_KIND: Record<string, Tab> = { direct: 'direct', group: 'group', project: 'project' };

function useWideScreen(): boolean {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
}

interface DeepLink {
  conversationId: string;
  messageId?: string | undefined;
  /** Following the same link again must still scroll to it. */
  nonce: number;
}

/** The Messages module: Direct Messages, Internal Groups and Project Groups, plus search and the saved tray. */
export function MessagesPage({ currentUserId, isSuperAdmin, canManageProjects }: { currentUserId: string; isSuperAdmin: boolean; canManageProjects: boolean }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('direct');
  const [deepLink, setDeepLink] = useState<DeepLink | undefined>(undefined);
  const [panel, setPanel] = useState<'search' | 'saved' | null>(null);
  const [savedVersion, setSavedVersion] = useState(0);
  const unread = useChatUnread();
  const wide = useWideScreen();
  const tabs = useMemo(() => [
    { value: 'direct', label: 'Direct Messages', shortLabel: 'Direct', badge: unread.direct },
    { value: 'group', label: 'Internal Groups', shortLabel: 'Internal', badge: unread.group },
    { value: 'project', label: 'Project Groups', shortLabel: 'Project', badge: unread.project },
  ] as const, [unread.direct, unread.group, unread.project]);

  const go = useCallback((target: { conversationId: string; messageId?: string | undefined; kind: ConversationKind }) => {
    setTab(TAB_FOR_KIND[target.kind] ?? 'direct');
    setDeepLink((current) => ({ conversationId: target.conversationId, messageId: target.messageId, nonce: (current?.nonce ?? 0) + 1 }));
    // On a phone or tablet the panel covers the thread: close it to show the message.
    if (!window.matchMedia('(min-width: 1024px)').matches) setPanel(null);
  }, []);

  // A notification click (e.g. a mention) arrives as a conversation deep link.
  // Resolve its kind, then let the matching inbox open and scroll to the message.
  useEffect(() => {
    const resolve = (search: string): void => {
      const params = new URLSearchParams(search);
      const conversationId = params.get('conversationId');
      if (!conversationId) return;
      const messageId = params.get('messageId') ?? undefined;
      void getConversation(conversationId)
        .then((conversation) => go({ conversationId, messageId, kind: conversation.kind }))
        .catch(() => undefined);
    };

    resolve(window.location.search);
    const onNavigate = (event: Event): void => {
      const target = (event as AppNavigateEvent).detail;
      const [path, search] = target.split('?');
      if (path !== '/company/messages' || !search) return;
      resolve(`?${search}`);
    };
    window.addEventListener(APP_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(APP_NAVIGATE_EVENT, onNavigate);
  }, [go]);

  // Ctrl/⌘+K or "/" opens search, the way Slack and Teams do.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        setPanel('search');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const panelBody = panel === 'search'
    ? <SearchPanel currentUserId={currentUserId} onOpen={go} onClose={() => setPanel(null)} />
    : panel === 'saved'
      ? <SavedPanel currentUserId={currentUserId} onOpen={go} onClose={() => setPanel(null)} version={savedVersion} />
      : null;

  const deepLinkProps = {
    initialConversationId: deepLink?.conversationId,
    initialMessageId: deepLink?.messageId,
    initialNonce: deepLink?.nonce ?? 0,
  };

  return (
    <div className="messages-page flex h-full min-h-0 flex-col px-3 pb-3 sm:px-4 sm:pb-4 md:px-8 md:pb-8">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <LiquidMessagesTabBar
            tabs={tabs}
            value={tab}
            onChange={(next) => {
              setDeepLink(undefined);
              setTab(next as Tab);
            }}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPanel(panel === 'search' ? null : 'search')}
            className={`grid size-10 place-items-center rounded-xl border bg-app-surface shadow-sm transition-colors ${panel === 'search' ? 'border-app-accent text-app-accent' : 'border-app-border text-app-muted hover:border-app-accent hover:text-app-accent'}`}
            aria-label="Search messages"
            aria-pressed={panel === 'search'}
            title="Search messages (Ctrl+K)"
          >
            <Icon name="search" className="size-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => {
              setSavedVersion((version) => version + 1);
              setPanel(panel === 'saved' ? null : 'saved');
            }}
            className={`grid size-10 place-items-center rounded-xl border bg-app-surface shadow-sm transition-colors ${panel === 'saved' ? 'border-app-accent text-app-accent' : 'border-app-border text-app-muted hover:border-app-accent hover:text-app-accent'}`}
            aria-label="Saved messages"
            aria-pressed={panel === 'saved'}
            title="Saved for later"
          >
            <Icon name="bookmark" className="size-[18px]" filled={panel === 'saved'} />
          </button>
        </div>
      </div>
      <div className="mt-3 flex min-h-0 flex-1 gap-3">
        <PanelSurface className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl">
          {tab === 'direct' ? (
            <DirectMessagesPage currentUserId={currentUserId} {...deepLinkProps} />
          ) : tab === 'group' ? (
            <InternalGroupsPage currentUserId={currentUserId} isSuperAdmin={isSuperAdmin} {...deepLinkProps} />
          ) : (
            <ProjectGroupsPage currentUserId={currentUserId} canManageProjects={canManageProjects} {...deepLinkProps} />
          )}
        </PanelSurface>
        {panelBody && wide && (
          <PanelSurface className="min-h-0 w-[380px] shrink-0 overflow-hidden rounded-2xl">{panelBody}</PanelSurface>
        )}
      </div>
      {panelBody && !wide && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-app-surface" role="dialog" aria-modal="true">
          {panelBody}
        </div>,
        document.body,
      )}
    </div>
  );
}
