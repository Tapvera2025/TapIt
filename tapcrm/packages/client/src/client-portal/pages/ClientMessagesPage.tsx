import { useEffect, useMemo } from 'react';
import { ConversationWorkspace } from '../../chat/ConversationWorkspace.js';
import type { ChatTransport } from '../../chat/transport.js';
import { Loading, Notice } from '../../ui/index.js';
import {
  deleteProjectDiscussionAttachment,
  editProjectDiscussionMessage,
  getProjectDiscussionMessageEdits,
  getProjectDiscussionPins,
  reactToProjectDiscussionMessage,
  removeProjectDiscussionReaction,
  sendProjectDiscussionMessage,
  uploadProjectDiscussionAttachment,
} from '../api/projectDiscussionApi.js';
import { useClientMessages } from '../useClientMessages.js';

export function ClientMessagesPage(): React.JSX.Element {
  const chat = useClientMessages();
  const activeId = chat.activeId;
  const loaded = chat.loaded;
  const openConversation = chat.openConversation;
  const projectIdForConversation = chat.projectIdForConversation;
  const firstConversationId = chat.conversations[0]?.id;
  useEffect(() => {
    if (loaded && !activeId && firstConversationId) void openConversation(firstConversationId);
  }, [activeId, firstConversationId, loaded, openConversation]);

  // The client "core set": files, any-emoji reactions, editing their own
  // messages and reading pins — every call scoped to the client's own project.
  const transport = useMemo<ChatTransport>(() => {
    const project = (conversationId: string): string => {
      const projectId = projectIdForConversation(conversationId);
      if (!projectId) throw new Error('This project discussion is no longer available.');
      return projectId;
    };
    return {
      sendMessage: async (conversationId, input) => sendProjectDiscussionMessage(project(conversationId), conversationId, input),
      editMessage: async (conversationId, messageId, body, mentionedUserIds) => editProjectDiscussionMessage(project(conversationId), conversationId, messageId, body, mentionedUserIds),
      getMessageEdits: async (conversationId, messageId) => getProjectDiscussionMessageEdits(project(conversationId), conversationId, messageId),
      reactToMessage: async (conversationId, messageId, emoji) => reactToProjectDiscussionMessage(project(conversationId), conversationId, messageId, emoji),
      removeReaction: async (conversationId, messageId, emoji) => removeProjectDiscussionReaction(project(conversationId), conversationId, messageId, emoji),
      uploadAttachment: async (conversationId, file, onProgress, signal) => uploadProjectDiscussionAttachment(project(conversationId), conversationId, file, onProgress, signal),
      deletePendingAttachment: async (conversationId, attachmentId) => deleteProjectDiscussionAttachment(project(conversationId), conversationId, attachmentId),
      getPins: async (conversationId) => getProjectDiscussionPins(project(conversationId), conversationId),
      presence: false,
    };
  }, [projectIdForConversation]);

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
              title={`Client project groups (${chat.conversations.length})`}
              emptyHint="No client project groups have been shared with you yet."
              conversationLabel={(conversation) => conversation.name || 'Client project group'}
              clientMode
              transport={transport}
            />
          )}
        </div>
      </div>
    </div>
  );
}
