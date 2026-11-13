import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCompanyEmployees, type CompanyEmployee } from '../company/api/companyApi.js';
import { Button, Loading, SegmentedTabs } from '../ui/index.js';
import {
  addGroupMembers,
  archiveGroup,
  createGroup,
  removeGroupMember,
  renameGroup,
  type Conversation,
} from './api/chatApi.js';
import { Avatar } from './Avatar.js';
import { ConversationWorkspace } from './ConversationWorkspace.js';
import { GroupSettingsModal } from './GroupSettingsModal.js';
import { groupAuthorityFor } from './groupPermissions.js';
import { usePresenceMap } from './presence.js';
import { useChat } from './useChat.js';

const label = (conversation: Conversation): string => conversation.name ?? 'Group';

type GroupView = 'active' | 'archived';
const VIEW_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archived' },
] as const;

interface GroupsPageProps {
  currentUserId: string;
  isSuperAdmin: boolean;
  initialConversationId?: string | undefined;
  initialMessageId?: string | undefined;
  initialNonce?: number | undefined;
  /** Whether the deep-linked group is archived, so the right list opens. */
  initialArchived?: boolean | undefined;
}

/**
 * Internal Groups. Creating a group is Super-Admin-only (`chat:manage-groups`).
 * Running one is shared: the creator (or any Super Admin) can make members
 * group admins, remove people, archive, restore and delete it; admins can
 * edit it, add people and remove ordinary members (server rules:
 * chat/group-roles.ts). Archived groups are listed under "Archived" for their
 * members, read-only.
 */
export function InternalGroupsPage(props: GroupsPageProps): React.JSX.Element {
  const { initialConversationId, initialArchived, initialNonce } = props;
  const linkView: GroupView = initialArchived ? 'archived' : 'active';
  const [view, setView] = useState<GroupView>(linkView);
  // A deep link opens its group once; after switching lists by hand it is not reopened.
  const [followLink, setFollowLink] = useState(true);

  useEffect(() => {
    if (!initialConversationId) return;
    setView(initialArchived ? 'archived' : 'active');
    setFollowLink(true);
  }, [initialConversationId, initialArchived, initialNonce]);

  const showLink = followLink && view === linkView;
  return (
    <GroupsInbox
      key={view}
      {...props}
      initialConversationId={showLink ? initialConversationId : undefined}
      initialMessageId={showLink ? props.initialMessageId : undefined}
      archived={view === 'archived'}
      onViewChange={(next) => {
        setFollowLink(false);
        setView(next);
      }}
    />
  );
}

function GroupsInbox({
  currentUserId,
  isSuperAdmin,
  initialConversationId,
  initialMessageId,
  initialNonce,
  archived,
  onViewChange,
}: GroupsPageProps & {
  archived: boolean;
  onViewChange: (view: GroupView) => void;
}): React.JSX.Element {
  const chat = useChat('group', { archived });
  const [showCreate, setShowCreate] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [colleagues, setColleagues] = useState<CompanyEmployee[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4_000);
    return () => clearTimeout(timer);
  }, [notice]);

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

  const settingsConversation = chat.conversations.find((c) => c.id === settingsId) ?? null;
  const canCreate = isSuperAdmin && !archived;

  return (
    <>
      <ConversationWorkspace
        chat={chat}
        kind="group"
        currentUserId={currentUserId}
        title="Internal Groups"
        emptyHint={
          archived
            ? 'No archived groups.'
            : isSuperAdmin
              ? 'No groups yet. Create one with "New Group".'
              : 'You have not been added to any internal group yet.'
        }
        conversationLabel={label}
        newLabel="New Group"
        initialConversationId={initialConversationId}
        initialMessageId={initialMessageId}
        initialNonce={initialNonce ?? 0}
        listToolbar={
          <SegmentedTabs
            items={VIEW_TABS}
            value={archived ? 'archived' : 'active'}
            onChange={(next) => onViewChange(next as GroupView)}
            ariaLabel="Show active or archived groups"
            density="compact"
          />
        }
        headerExtra={(conversation: Conversation) => (
          <Button
            kind="secondary"
            onClick={() => setSettingsId(conversation.id)}
            className="!px-3 !py-1.5 !text-xs"
          >
            {groupAuthorityFor(conversation, currentUserId, isSuperAdmin) === 'member'
              ? 'Group info'
              : 'Manage'}
          </Button>
        )}
        {...(canCreate ? { onNewClick: openCreate } : {})}
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

      {settingsConversation && (
        <GroupSettingsModal
          conversation={settingsConversation}
          currentUserId={currentUserId}
          authority={groupAuthorityFor(settingsConversation, currentUserId, isSuperAdmin)}
          onClose={() => setSettingsId(null)}
          onChanged={() => void chat.refreshConversations()}
          onLeftView={(message) => {
            setSettingsId(null);
            chat.setActiveId(null);
            setNotice(message);
            void chat.refreshConversations();
          }}
          onError={setError}
        />
      )}

      {(error || chat.error) && (
        <p role="alert" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#d86b6b]/30 bg-app-surface px-4 py-2 text-sm text-app-danger shadow-lg">
          {error || chat.error}
        </p>
      )}
      {notice && !(error || chat.error) && (
        <p role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-app-accent/30 bg-app-surface px-4 py-2 text-sm text-app-foreground shadow-lg">
          {notice}
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

  return createPortal(
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
        <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
    </div>,
    document.body,
  );
}

export type GroupManagementActions = {
  rename: (name: string, description: string | null) => Promise<unknown>;
  addMembers: (memberIds: string[]) => Promise<unknown>;
  removeMember: (userId: string) => Promise<unknown>;
  archive: () => Promise<unknown>;
};

export function ManageGroupModal({
  conversation,
  colleagues,
  onClose,
  onRefresh,
  onError,
  actions,
}: {
  conversation: Conversation;
  colleagues: { id: string; fullName: string }[];
  onClose: () => void;
  onRefresh: () => void;
  onError: (message: string) => void;
  actions?: GroupManagementActions;
}): React.JSX.Element {
  const [name, setName] = useState(conversation.name ?? '');
  const [description, setDescription] = useState(conversation.description ?? '');
  const [addingMemberId, setAddingMemberId] = useState('');
  const presence = usePresenceMap(true);
  const memberIds = new Set(conversation.members.map((m) => m.userId));
  const addable = colleagues.filter((c) => !memberIds.has(c.id));
  const groupActions = actions ?? {
    rename: (name: string, description: string | null) => renameGroup(conversation.id, name, description),
    addMembers: (memberIds: string[]) => addGroupMembers(conversation.id, memberIds),
    removeMember: (userId: string) => removeGroupMember(conversation.id, userId),
    archive: () => archiveGroup(conversation.id),
  };

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
      onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'That action failed.');
    }
  };

  return createPortal(
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
              onClick={() => void run(() => groupActions.rename(name.trim(), description.trim() || null))}
              disabled={!name.trim() || (name.trim() === conversation.name && description.trim() === (conversation.description ?? ''))}
              className="!px-3 !py-1.5 !text-xs"
            >
              Save
            </Button>
          </div>
        </div>

        <p className="mb-1 text-xs font-semibold text-app-muted">Members</p>
        <ul data-lenis-prevent className="mb-3 min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {conversation.members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-2 py-1 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={member.fullName} seed={member.userId} presence={presence[member.userId]} size="xs" />
                <span className="truncate">{member.fullName}</span>
              </span>
              {member.userId !== conversation.createdBy && (
                <button type="button" onClick={() => void run(() => groupActions.removeMember(member.userId))} className="text-xs text-app-danger hover:underline">
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
              onClick={() => void run(() => groupActions.addMembers([addingMemberId])).then(() => setAddingMemberId(''))}
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
            onClick={() => void run(groupActions.archive).then(onClose)}
            className="!px-3 !py-1.5 !text-xs"
          >
            Archive group
          </Button>
          <Button kind="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
