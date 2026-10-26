import { ConversationWorkspace } from '../../chat/ConversationWorkspace.js';
import { Loading, Notice } from '../../ui/components.js';
import { reactToProjectDiscussionMessage, removeProjectDiscussionReaction, sendProjectDiscussionMessage } from '../api/projectDiscussionApi.js';
import { useClientMessages } from '../useClientMessages.js';
import { useEffect } from 'react';

export function ClientMessagesPage(): React.JSX.Element {
  const chat = useClientMessages();
  const activeId = chat.activeId;
  const projectId = activeId ? chat.projectIdForConversation(activeId) : null;
  const loaded = chat.loaded;
  const openConversation = chat.openConversation;
  const firstConversationId = chat.conversations[0]?.id;
  useEffect(() => {
    if (loaded && !activeId && firstConversationId) void openConversation(firstConversationId);
  }, [activeId, firstConversationId, loaded, openConversation]);

  return (
    <div className="workspace-page-container flex h-full min-h-0 w-full flex-col">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-app-border pb-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-[-0.03em] text-app-foreground sm:text-2xl">Messages</h1>
            <p className="mt-0.5 truncate text-xs text-app-muted sm:text-sm">Your project team conversation</p>
          </div>
        </header>
        <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-sm" aria-label="Project messages">
          {!chat.loaded ? (
            <div className="p-4"><Loading /></div>
          ) : chat.error && chat.conversations.length === 0 ? (
            <div className="p-4"><Notice error>Unable to load your client group conversations.</Notice></div>
          ) : (
            <ConversationWorkspace
              chat={chat}
              kind="project"
              currentUserId={chat.currentUserId}
              title="Client project groups"
              emptyHint="No client project groups have been shared with you yet."
              conversationLabel={(conversation) => conversation.name || 'Client project group'}
              hideList
              clientMode
              messageActions={{
                sendMessage: (_conversationId, body, replyToMessageId, mentionedUserIds) => projectId && activeId
                  ? sendProjectDiscussionMessage(projectId, activeId, body, replyToMessageId, mentionedUserIds)
                  : Promise.reject(new Error('This project discussion is no longer available.')),
                reactToMessage: (messageId, emoji) => projectId && activeId
                  ? reactToProjectDiscussionMessage(projectId, activeId, messageId, emoji)
                  : Promise.reject(new Error('This project discussion is no longer available.')),
                removeReaction: (messageId, emoji) => projectId && activeId
                  ? removeProjectDiscussionReaction(projectId, activeId, messageId, emoji)
                  : Promise.reject(new Error('This project discussion is no longer available.')),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
