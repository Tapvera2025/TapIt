import { useEffect, useState } from 'react';
import { APP_NAVIGATE_EVENT, type AppNavigateEvent } from '../navigationEvent.js';
import { getConversation } from './api/chatApi.js';
import { DirectMessagesPage } from './DirectMessagesPage.js';
import { InternalGroupsPage } from './InternalGroupsPage.js';
import { ProjectGroupsPage } from './ProjectGroupsPage.js';

type Tab = 'direct' | 'group' | 'project';

const TAB_FOR_KIND: Record<string, Tab> = { direct: 'direct', group: 'group', project: 'project' };

/**
 * The Messages module: Direct Messages (Phase 2), Internal Groups (Phase 3)
 * and Project Groups (Phase 4) — one conversation per project, created by
 * the project wizard's second step.
 */
export function MessagesPage({ currentUserId, isSuperAdmin }: { currentUserId: string; isSuperAdmin: boolean }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('direct');
  const [deepLink, setDeepLink] = useState<{ conversationId: string; messageId?: string | undefined } | undefined>(undefined);

  // A notification click (e.g. a mention) arrives as "?conversationId=...&messageId=...";
  // resolve which tab that conversation lives on, then hand the id down so
  // ConversationWorkspace opens it and scrolls to the message.
  useEffect(() => {
    const resolve = (search: string): void => {
      const params = new URLSearchParams(search);
      const conversationId = params.get('conversationId');
      if (!conversationId) return;
      const messageId = params.get('messageId') ?? undefined;
      void getConversation(conversationId)
        .then((conversation) => {
          setTab(TAB_FOR_KIND[conversation.kind] ?? 'direct');
          setDeepLink({ conversationId, messageId });
        })
        .catch(() => undefined);
    };

    resolve(window.location.search); // arriving here fresh (e.g. from another page)

    // Also arriving here: a SECOND notification clicked while already on this
    // page. The URL changes (pushState) but this component's own mount
    // effect would never re-run on its own, since "pathname" itself doesn't
    // change when the destination is already "/company/messages" — so listen
    // for App.tsx's navigate() directly instead of only reading on mount.
    const onNavigate = (event: Event): void => {
      const target = (event as AppNavigateEvent).detail;
      const [path, search] = target.split('?');
      if (path !== '/company/messages' || !search) return;
      resolve(`?${search}`);
    };
    window.addEventListener(APP_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(APP_NAVIGATE_EVENT, onNavigate);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-app-border px-4 pt-3">
        {([['direct', 'Direct Messages'], ['group', 'Internal Groups'], ['project', 'Project Groups']] as const).map(([value, tabLabel]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              // A manual tab switch overrides whatever a notification deep
              // link opened — otherwise the old conversation keeps forcing
              // itself back open every time its tab remounts.
              setDeepLink(undefined);
              setTab(value);
            }}
            className={`rounded-t-lg px-3 py-2 text-sm font-semibold ${tab === value ? 'border-b-2 border-app-accent text-app-accent' : 'text-app-muted hover:text-app-foreground'}`}
          >
            {tabLabel}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'direct' ? (
          <DirectMessagesPage currentUserId={currentUserId} initialConversationId={deepLink?.conversationId} initialMessageId={deepLink?.messageId} />
        ) : tab === 'group' ? (
          <InternalGroupsPage currentUserId={currentUserId} isSuperAdmin={isSuperAdmin} initialConversationId={deepLink?.conversationId} initialMessageId={deepLink?.messageId} />
        ) : (
          <ProjectGroupsPage currentUserId={currentUserId} initialConversationId={deepLink?.conversationId} initialMessageId={deepLink?.messageId} />
        )}
      </div>
    </div>
  );
}
