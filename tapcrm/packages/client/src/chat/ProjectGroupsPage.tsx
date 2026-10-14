import { getChatColleagues, type Conversation } from './api/chatApi.js';
import { addDiscussionGroupMembers, archiveDiscussionGroup, removeDiscussionGroupMember, updateDiscussionGroup } from '../projects/api/projectsApi.js';
import { ManageGroupModal } from './InternalGroupsPage.js';
import { useState } from 'react';
import { ConversationWorkspace } from './ConversationWorkspace.js';
import { useChat } from './useChat.js';

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
}: {
  currentUserId: string;
  canManageProjects: boolean;
  initialConversationId?: string | undefined;
  initialMessageId?: string | undefined;
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
        {...(canManageProjects ? { headerExtra: (conversation: Conversation) => <button type="button" onClick={() => openManage(conversation.id)} className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent">Manage</button> } : {})}
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
      {(error || chat.error) && <p role="alert" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#d86b6b]/30 bg-app-surface px-4 py-2 text-sm text-app-danger shadow-lg">{error || chat.error}</p>}
    </>
  );
}
