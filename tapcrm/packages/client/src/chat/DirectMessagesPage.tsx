import { useState } from 'react';
import { Loading } from '../ui/components.js';
import { getChatColleagues, startDirectConversation, type Conversation } from './api/chatApi.js';
import { ConversationWorkspace } from './ConversationWorkspace.js';
import { useChat } from './useChat.js';

function otherMember(conversation: Conversation, myId: string): { userId: string; fullName: string } | null {
  const other = conversation.members.find((m) => m.userId !== myId);
  return other ? { userId: other.userId, fullName: other.fullName } : null;
}

/**
 * Direct Messages — Phase 2 of the messaging build. One of the three planned
 * tabs (Internal Groups is Phase 3; Project Group is Phase 4); see
 * team-docs for the full plan and packages/server/src/modules/chat for the
 * reference server implementation this UI talks to.
 */
export function DirectMessagesPage({
  currentUserId,
  initialConversationId,
  initialMessageId,
}: {
  currentUserId: string;
  initialConversationId?: string | undefined;
  initialMessageId?: string | undefined;
}): React.JSX.Element {
  const chat = useChat('direct');
  const [showPicker, setShowPicker] = useState(false);
  const [colleagues, setColleagues] = useState<{ id: string; fullName: string }[]>([]);
  const [colleaguesLoaded, setColleaguesLoaded] = useState(false);
  const [error, setError] = useState('');

  const openPicker = (): void => {
    setShowPicker(true);
    if (!colleaguesLoaded) {
      void getChatColleagues()
        .then((list) => setColleagues(list))
        .catch(() => setColleagues([]))
        .finally(() => setColleaguesLoaded(true));
    }
  };

  const startChatWith = async (userId: string): Promise<void> => {
    setShowPicker(false);
    try {
      const conversation = await startDirectConversation(userId);
      await chat.refreshConversations();
      await chat.openConversation(conversation.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start conversation.');
    }
  };

  return (
    <>
      <ConversationWorkspace
        chat={chat}
        kind="direct"
        currentUserId={currentUserId}
        title="Direct Messages"
        emptyHint='No conversations yet. Start one with "New".'
        conversationLabel={(conversation) => otherMember(conversation, currentUserId)?.fullName ?? 'Conversation'}
        onNewClick={openPicker}
        initialConversationId={initialConversationId}
        initialMessageId={initialMessageId}
      />

      {showPicker && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setShowPicker(false)}>
          <div className="ui-card max-h-[70vh] w-full max-w-sm overflow-y-auto p-4" onClick={(event) => event.stopPropagation()}>
            <p className="mb-3 text-sm font-semibold">Start a conversation</p>
            {!colleaguesLoaded ? (
              <Loading />
            ) : colleagues.length === 0 ? (
              <p className="text-sm text-app-muted">No one else is available to message yet.</p>
            ) : (
              <ul>
                {colleagues.map((person) => (
                  <li key={person.id}>
                    <button type="button" onClick={() => void startChatWith(person.id)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-app-surface-raised">
                      {person.fullName}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#d86b6b]/30 bg-app-surface px-4 py-2 text-sm text-app-danger shadow-lg">
          {error}
        </p>
      )}
    </>
  );
}
