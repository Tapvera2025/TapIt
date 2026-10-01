import { useEffect, useState } from 'react';
import { ConversationWorkspace, type Conversation } from '../chat/index.js';
import { useChat } from '../chat/useChat.js';
import { Button, Empty, Modal, Notice } from '../ui/components.js';
import { updateDiscussionGroup, type Project } from './api/projectsApi.js';
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
  const [showEditGroup, setShowEditGroup] = useState(false);

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
    <div className="h-full min-h-0">
      <ConversationWorkspace
        chat={chat}
        kind="project"
        currentUserId={currentUserId}
        title="Project Discussion"
        emptyHint="Loading…"
        conversationLabel={() => project.name}
        hideList
        headerExtra={() => (
          <Button kind="secondary" onClick={() => setShowEditGroup(true)} className="!px-3 !py-1.5 !text-xs">
            Edit group
          </Button>
        )}
      />

      {showEditGroup && (
        <EditDiscussionGroupModal
          projectId={project.id}
          conversation={chat.conversations.find((c) => c.id === project.discussionConversationId) ?? null}
          onClose={() => setShowEditGroup(false)}
          onSaved={() => { setShowEditGroup(false); void chat.refreshConversations(); }}
        />
      )}
    </div>
  );
}

function EditDiscussionGroupModal({
  projectId,
  conversation,
  onClose,
  onSaved,
}: {
  projectId: string;
  conversation: Conversation | null;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(conversation?.name ?? '');
  const [description, setDescription] = useState(conversation?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await updateDiscussionGroup(projectId, name.trim(), description.trim() || null);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update the group.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit discussion group" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        {error && <Notice error>{error}</Notice>}
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-1.5 block">Group name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
          />
        </label>
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-1.5 block">Description (optional)</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button kind="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
