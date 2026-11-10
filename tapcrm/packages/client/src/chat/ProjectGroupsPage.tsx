import { getChatColleagues, type Conversation } from './api/chatApi.js';
import { addDiscussionGroupMembers, archiveDiscussionGroup, removeDiscussionGroupMember, updateDiscussionGroup } from '../projects/api/projectsApi.js';
import { ManageGroupModal } from './InternalGroupsPage.js';
import { useState } from 'react';
import { ConversationWorkspace } from './ConversationWorkspace.js';
import { useChat } from './useChat.js';
import { Button, Notice } from '../ui/index.js';

const label = (conversation: Conversation): string => conversation.name ?? 'Project Group';

/**
 * Project Groups — Phase 4. One conversation per project, created by the
 * project wizard's second step (preselected members + a name derived from
 * the project and client). Renaming/describing it or adding members is done
 * from the project's own Discussions tab (`projects:manage`), not here —
 * chat's own group governance (`chat:manage-groups`) explicitly refuses
 * 'project' conversations, so this tab stays read/post only.
 */
export function ProjectGroupsPage({
  currentUserId,
  canManageProjects,
  initialConversationId,
  initialMessageId,
  initialNonce,
}: {
  currentUserId: string;
  canManageProjects: boolean;
  initialConversationId?: string | undefined;
  initialMessageId?: string | undefined;
  initialNonce?: number | undefined;
}): React.JSX.Element {
  const chat = useChat('project');
  const [managingId, setManagingId] = useState<string | null>(null);
  const [colleagues, setColleagues] = useState<{ id: string; fullName: string }[]>([]);
  const [error, setError] = useState('');
  const openManage = (conversationId: string): void => {
    setManagingId(conversationId);
    if (colleagues.length === 0)
      void getChatColleagues().then(setColleagues).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load employees.'));
  };
  const managingConversation = chat.conversations.find((conversation) => conversation.id === managingId) ?? null;

  return (
    <>
      <ConversationWorkspace
        chat={chat}
        kind="project"
        currentUserId={currentUserId}
        title="Project Groups"
        emptyHint="You have not been added to a project group yet."
        conversationLabel={label}
        initialConversationId={initialConversationId}
        initialMessageId={initialMessageId}
        initialNonce={initialNonce ?? 0}
        {...(canManageProjects ? { headerExtra: (conversation: Conversation) => <Button kind="secondary" onClick={() => openManage(conversation.id)} className="px-3 py-1.5 text-xs">Manage</Button> } : {})}
      />
      {managingConversation && (
        <ManageGroupModal
          conversation={managingConversation}
          colleagues={colleagues.filter((person) => person.id !== currentUserId)}
          onClose={() => setManagingId(null)}
          onRefresh={() => void chat.refreshConversations()}
          onError={setError}
          actions={{
            rename: (name, description) => updateDiscussionGroup(managingConversation.projectId!, name, description),
            addMembers: (memberIds) => addDiscussionGroupMembers(managingConversation.projectId!, memberIds),
            removeMember: (userId) => removeDiscussionGroupMember(managingConversation.projectId!, userId),
            archive: () => archiveDiscussionGroup(managingConversation.projectId!),
          }}
        />
      )}
      {(error || chat.error) && <div className="fixed bottom-4 left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2"><Notice error>{error || chat.error}</Notice></div>}
    </>
  );
}
