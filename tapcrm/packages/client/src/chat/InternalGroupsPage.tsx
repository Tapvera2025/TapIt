import { useState } from 'react';
import { getCompanyEmployees, type CompanyEmployee } from '../company/api/companyApi.js';
import { Button, Loading } from '../ui/components.js';
import {
  addGroupMembers,
  archiveGroup,
  createGroup,
  removeGroupMember,
  renameGroup,
  type Conversation,
} from './api/chatApi.js';
import { ConversationWorkspace } from './ConversationWorkspace.js';
import { useChat } from './useChat.js';

const label = (conversation: Conversation): string => conversation.name ?? 'Group';

/**
 * Internal Groups — Phase 3 of the messaging build. Creating and managing a
 * group's name/membership is Super-Admin-only (`chat:manage-groups`,
 * enforced server-side); any member the Super Admin adds can read and post
 * exactly like a Direct Message, via the same `chat:view`/`chat:send` every
 * employee position already holds. Non-admins therefore see the list and
 * thread below with no "New" button and no "Manage" panel.
 */
export function InternalGroupsPage({
  currentUserId,
  isSuperAdmin,
  initialConversationId,
  initialMessageId,
}: {
  currentUserId: string;
  isSuperAdmin: boolean;
  initialConversationId?: string | undefined;
  initialMessageId?: string | undefined;
}): React.JSX.Element {
  const chat = useChat('group');
  const [showCreate, setShowCreate] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [colleagues, setColleagues] = useState<CompanyEmployee[]>([]);
  const [error, setError] = useState('');

  const loadColleagues = (): void => {
    if (colleagues.length > 0) return;
    void getCompanyEmployees()
      .then((list) => setColleagues(list.filter((e) => e.id !== currentUserId)))
      .catch(() => setColleagues([]));
  };

  const openCreate = (): void => {
    setShowCreate(true);
    loadColleagues();
  };

  const managingConversation = chat.conversations.find((c) => c.id === managingId) ?? null;

  return (
    <>
      <ConversationWorkspace
        chat={chat}
        kind="group"
        currentUserId={currentUserId}
        title="Internal Groups"
        emptyHint={isSuperAdmin ? 'No groups yet. Create one with "New Group".' : 'You have not been added to any internal group yet.'}
        conversationLabel={label}
        newLabel="New Group"
        initialConversationId={initialConversationId}
        initialMessageId={initialMessageId}
        {...(isSuperAdmin
          ? {
              onNewClick: openCreate,
              headerExtra: (conversation: Conversation) => (
                <Button kind="secondary" onClick={() => { setManagingId(conversation.id); loadColleagues(); }} className="!px-3 !py-1.5 !text-xs">
                  Manage
                </Button>
              ),
            }
          : {})}
      />

      {showCreate && (
        <CreateGroupModal
          colleagues={colleagues}
          onClose={() => setShowCreate(false)}
          onCreate={async (name, memberIds, description) => {
            try {
              const group = await createGroup(name, memberIds, description);
              setShowCreate(false);
              await chat.refreshConversations();
              await chat.openConversation(group.id);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Unable to create group.');
            }
          }}
        />
      )}

      {managingConversation && (
        <ManageGroupModal
          conversation={managingConversation}
          colleagues={colleagues}
          onClose={() => setManagingId(null)}
          onRefresh={() => void chat.refreshConversations()}
          onError={setError}
        />
      )}

      {(error || chat.error) && (
        <p role="alert" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#d86b6b]/30 bg-app-surface px-4 py-2 text-sm text-app-danger shadow-lg">
          {error || chat.error}
        </p>
      )}
    </>
  );
}

function CreateGroupModal({
  colleagues,
  onClose,
  onCreate,
}: {
  colleagues: CompanyEmployee[];
  onClose: () => void;
  onCreate: (name: string, memberIds: string[], description: string | null) => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const toggle = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    if (!name.trim() || selected.size === 0 || saving) return;
    setSaving(true);
    try {
      await onCreate(name.trim(), [...selected], description.trim() || null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="ui-card flex max-h-[80vh] w-full max-w-sm flex-col p-4" onClick={(event) => event.stopPropagation()}>
        <p className="mb-3 text-sm font-semibold">New Internal Group</p>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Group name"
          className="mb-3 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm outline-none focus:border-app-accent"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="mb-3 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm outline-none focus:border-app-accent"
        />
        <p className="mb-1 text-xs font-semibold text-app-muted">Members</p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {colleagues.length === 0 ? (
            <Loading />
          ) : (
            <ul>
              {colleagues.map((person) => (
                <li key={person.id}>
                  <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-app-surface-raised">
                    <input type="checkbox" checked={selected.has(person.id)} onChange={() => toggle(person.id)} />
                    {person.fullName}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !name.trim() || selected.size === 0}>Create</Button>
        </div>
      </div>
    </div>
  );
}

export function ManageGroupModal({
  conversation,
  colleagues,
  onClose,
  onRefresh,
  onError,
}: {
  conversation: Conversation;
  colleagues: { id: string; fullName: string }[];
  onClose: () => void;
  onRefresh: () => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState(conversation.name ?? '');
  const [description, setDescription] = useState(conversation.description ?? '');
  const [addingMemberId, setAddingMemberId] = useState('');
  const memberIds = new Set(conversation.members.map((m) => m.userId));
  const addable = colleagues.filter((c) => !memberIds.has(c.id));

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
      onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'That action failed.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="ui-card flex max-h-[80vh] w-full max-w-sm flex-col p-4" onClick={(event) => event.stopPropagation()}>
        <p className="mb-3 text-sm font-semibold">Manage “{conversation.name}”</p>

        <div className="mb-4 space-y-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm outline-none focus:border-app-accent"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm outline-none focus:border-app-accent"
          />
          <div className="flex justify-end">
            <Button
              kind="secondary"
              onClick={() => void run(() => renameGroup(conversation.id, name.trim(), description.trim() || null))}
              disabled={!name.trim() || (name.trim() === conversation.name && description.trim() === (conversation.description ?? ''))}
              className="!px-3 !py-1.5 !text-xs"
            >
              Save
            </Button>
          </div>
        </div>

        <p className="mb-1 text-xs font-semibold text-app-muted">Members</p>
        <ul className="mb-3 min-h-0 flex-1 overflow-y-auto">
          {conversation.members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-2 py-1 text-sm">
              <span>{member.fullName}</span>
              {member.userId !== conversation.createdBy && (
                <button type="button" onClick={() => void run(() => removeGroupMember(conversation.id, member.userId))} className="text-xs text-app-danger hover:underline">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        {addable.length > 0 && (
          <div className="mb-3 flex gap-2">
            <select
              value={addingMemberId}
              onChange={(event) => setAddingMemberId(event.target.value)}
              className="flex-1 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm outline-none focus:border-app-accent"
            >
              <option value="">Add a member…</option>
              {addable.map((person) => (
                <option key={person.id} value={person.id}>{person.fullName}</option>
              ))}
            </select>
            <Button
              kind="secondary"
              onClick={() => void run(() => addGroupMembers(conversation.id, [addingMemberId])).then(() => setAddingMemberId(''))}
              disabled={!addingMemberId}
              className="!px-3 !py-1.5 !text-xs"
            >
              Add
            </Button>
          </div>
        )}

        <div className="flex justify-between gap-2">
          <Button
            kind="danger"
            onClick={() => void run(() => archiveGroup(conversation.id)).then(onClose)}
            className="!px-3 !py-1.5 !text-xs"
          >
            Archive group
          </Button>
          <Button kind="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
