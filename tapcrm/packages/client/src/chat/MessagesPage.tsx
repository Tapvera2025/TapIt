import { useEffect, useMemo, useState } from 'react';
import { APP_NAVIGATE_EVENT, type AppNavigateEvent } from '../navigationEvent.js';
import { getConversation } from './api/chatApi.js';
import { DirectMessagesPage } from './DirectMessagesPage.js';
import { InternalGroupsPage } from './InternalGroupsPage.js';
import { ProjectGroupsPage } from './ProjectGroupsPage.js';
import { LiquidMessagesTabBar } from './LiquidMessagesTabBar.js';
import { useChatUnread } from './ChatUnreadContext.js';

type Tab = 'direct' | 'group' | 'project';
const TAB_FOR_KIND: Record<string, Tab> = { direct: 'direct', group: 'group', project: 'project' };

/** The Messages module: Direct Messages, Internal Groups, and Project Groups. */
export function MessagesPage({ currentUserId, isSuperAdmin, canManageProjects }: { currentUserId: string; isSuperAdmin: boolean; canManageProjects: boolean }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('direct');
  const [deepLink, setDeepLink] = useState<{ conversationId: string; messageId?: string | undefined } | undefined>(undefined);
  const unread = useChatUnread();
  const tabs = useMemo(() => [
    { value: 'direct', label: 'Direct Messages', shortLabel: 'Direct', badge: unread.direct },
    { value: 'group', label: 'Internal Groups', shortLabel: 'Internal', badge: unread.group },
    { value: 'project', label: 'Project Groups', shortLabel: 'Project', badge: unread.project },
  ] as const, [unread.direct, unread.group, unread.project]);

  // A notification click (e.g. a mention) arrives as a conversation deep link.
  // Resolve its kind, then let the matching inbox open and scroll to the message.
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

    resolve(window.location.search);
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
    <div className="messages-page flex h-full min-h-0 flex-col px-3 pb-3 sm:px-4 sm:pb-4 md:px-8 md:pb-8">
      <LiquidMessagesTabBar
        tabs={tabs}
        value={tab}
        onChange={(next) => {
          setDeepLink(undefined);
          setTab(next as Tab);
        }}
      />
      <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl bg-app-surface">
        {tab === 'direct' ? (
          <DirectMessagesPage currentUserId={currentUserId} initialConversationId={deepLink?.conversationId} initialMessageId={deepLink?.messageId} />
        ) : tab === 'group' ? (
          <InternalGroupsPage currentUserId={currentUserId} isSuperAdmin={isSuperAdmin} initialConversationId={deepLink?.conversationId} initialMessageId={deepLink?.messageId} />
        ) : (
          <ProjectGroupsPage currentUserId={currentUserId} canManageProjects={canManageProjects} initialConversationId={deepLink?.conversationId} initialMessageId={deepLink?.messageId} />
        )}
      </div>
    </div>
  );
}
