import type { Conversation } from './api/chatApi.js';
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
  initialConversationId,
  initialMessageId,
}: {
  currentUserId: string;
  initialConversationId?: string | undefined;
  initialMessageId?: string | undefined;
}): React.JSX.Element {
  const chat = useChat('project');

  return (
    <ConversationWorkspace
      chat={chat}
      kind="project"
      currentUserId={currentUserId}
      title="Project Groups"
      emptyHint="You have not been added to a project group yet."
      conversationLabel={label}
      initialConversationId={initialConversationId}
      initialMessageId={initialMessageId}
    />
  );
}
