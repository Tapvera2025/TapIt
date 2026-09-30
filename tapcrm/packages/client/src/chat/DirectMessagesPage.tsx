import { useState } from 'react';
import { getCompanyEmployees, type CompanyEmployee } from '../company/api/companyApi.js';
import { Loading } from '../ui/components.js';
import { startDirectConversation, type Conversation } from './api/chatApi.js';
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
export function DirectMessagesPage({ currentUserId }: { currentUserId: string }): React.JSX.Element {
  const chat = useChat('direct');
  const [showPicker, setShowPicker] = useState(false);
  const [colleagues, setColleagues] = useState<CompanyEmployee[]>([]);
  const [error, setError] = useState('');

  const openPicker = (): void => {
    setShowPicker(true);
    if (colleagues.length === 0) {
      void getCompanyEmployees()
        .then((list) => setColleagues(list.filter((e) => e.id !== currentUserId)))
        .catch(() => setColleagues([]));
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
      />

      {showPicker && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setShowPicker(false)}>
          <div className="ui-card max-h-[70vh] w-full max-w-sm overflow-y-auto p-4" onClick={(event) => event.stopPropagation()}>
            <p className="mb-3 text-sm font-semibold">Start a conversation</p>
            {colleagues.length === 0 ? (
              <Loading />
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
