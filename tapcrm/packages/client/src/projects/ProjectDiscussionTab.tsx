import { useEffect, useState } from 'react';
import { ConversationWorkspace } from '../chat/index.js';
import { useChat } from '../chat/useChat.js';
import { Button, Empty } from '../ui/components.js';
import type { Project } from './api/projectsApi.js';
import { CreateDiscussionGroupModal } from './CreateDiscussionGroupModal.js';

/**
 * A project's Discussions tab: the combined employees + client thread
 * created by the wizard's second step (or, if that step was skipped,
 * created here). One conversation, so the picker/list side of
 * `ConversationWorkspace` is hidden (`hideList`).
 */
export function ProjectDiscussionTab({ project, currentUserId, onProjectUpdated }: { project: Project; currentUserId: string; onProjectUpdated: (project: Project) => void }): React.JSX.Element {
  const chat = useChat('project');
  const [showCreate, setShowCreate] = useState(false);

  // Deliberately omits `chat`: openConversation is a stable useCallback, and re-running on every chat update would refetch messages in a loop.
  useEffect(() => {
    if (project.discussionConversationId) void chat.openConversation(project.discussionConversationId);
  }, [project.discussionConversationId]);

  if (!project.discussionConversationId) {
    return (
      <>
        <Empty>
          This project has no discussion group yet.
          <div className="mt-3"><Button onClick={() => setShowCreate(true)}>Create discussion group</Button></div>
        </Empty>
        {showCreate && (
          <CreateDiscussionGroupModal
            project={project}
            onClose={() => setShowCreate(false)}
            onCreated={(updated) => { setShowCreate(false); onProjectUpdated(updated); }}
          />
        )}
      </>
    );
  }

  return (
    <div className="h-[70vh]">
      <ConversationWorkspace
        chat={chat}
        kind="project"
        currentUserId={currentUserId}
        title="Project Discussion"
        emptyHint="Loading…"
        conversationLabel={() => project.name}
        hideList
      />
    </div>
  );
}
