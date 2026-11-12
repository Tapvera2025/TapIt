import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/index.js';
import {
  addGroupMembers,
  archiveGroup,
  deleteGroup,
  getChatColleagues,
  removeGroupMember,
  renameGroup,
  restoreGroup,
  setGroupMemberRole,
  type Conversation,
} from './api/chatApi.js';
import { Avatar } from './Avatar.js';
import {
  canChangeAdmin,
  canRemoveMember,
  membersByRank,
  type GroupAuthority,
} from './groupPermissions.js';
import { usePresenceMap } from './presence.js';

const smallButton = '!px-3 !py-1.5 !text-xs';

/**
 * An Internal Group's settings. The creator (or a Super Admin) sees
 * everything: edit, add and remove people, make admins, archive, restore and
 * delete. An admin can edit, add people and remove ordinary members. Everyone
 * else sees who is in the group and who runs it.
 */
export function GroupSettingsModal({
  conversation,
  currentUserId,
  authority,
  onClose,
  onChanged,
  onLeftView,
  onError,
}: {
  conversation: Conversation;
  currentUserId: string;
  authority: GroupAuthority;
  onClose: () => void;
  /** Something changed: reload the list (the modal reads the fresh group from it). */
  onChanged: () => void;
  /** Archived, restored or deleted: the group no longer belongs in the list being viewed. */
  onLeftView: (message: string) => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  const archived = Boolean(conversation.archivedAt);
  const canEdit = !archived && authority !== 'member';
  const [name, setName] = useState(conversation.name ?? '');
  const [description, setDescription] = useState(conversation.description ?? '');
  const [colleagues, setColleagues] = useState<{ id: string; fullName: string }[]>([]);
  const [addingMemberId, setAddingMemberId] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const presence = usePresenceMap(true);

  useEffect(() => {
    if (!canEdit) return;
    void getChatColleagues()
      .then(setColleagues)
      .catch(() => setColleagues([]));
  }, [canEdit]);

  const memberIds = new Set(conversation.members.map((member) => member.userId));
  const addable = colleagues.filter((person) => !memberIds.has(person.id));
  const nameChanged =
    name.trim() !== (conversation.name ?? '') ||
    description.trim() !== (conversation.description ?? '');

  const run = async (
    action: () => Promise<unknown>,
    after?: () => void,
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onChanged();
      after?.();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'That action failed.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${conversation.name ?? 'Group'} settings`}
        className="ui-card flex max-h-[85vh] w-full max-w-md flex-col p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            {authority === 'member' ? 'Group info' : 'Manage group'} · {conversation.name}
          </p>
          {archived && (
            <span className="shrink-0 rounded-full border border-app-border px-2 py-0.5 text-[10px] font-semibold uppercase text-app-muted">
              Archived
            </span>
          )}
        </div>

        {archived ? (
          <p className="mb-3 text-xs text-app-muted">
            {authority === 'owner'
              ? 'This group is archived, so it is read-only. Restore it to make changes or send messages again.'
              : 'This group is archived, so it is read-only.'}
          </p>
        ) : authority === 'member' ? (
          <p className="mb-3 text-xs text-app-muted">
            Only the group creator and its admins can change this group.
          </p>
        ) : authority === 'admin' ? (
          <p className="mb-3 text-xs text-app-muted">
            As an admin you can edit the group, add people and remove members. Only the
            creator can make or remove admins.
          </p>
        ) : null}

        {canEdit ? (
          <div className="mb-4 space-y-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Group name"
              className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm outline-none focus:border-app-accent"
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description (optional)"
              aria-label="Group description"
              rows={2}
              className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm outline-none focus:border-app-accent"
            />
            <div className="flex justify-end">
              <Button
                kind="secondary"
                onClick={() =>
                  void run(() =>
                    renameGroup(conversation.id, name.trim(), description.trim() || null),
                  )
                }
                disabled={busy || !name.trim() || !nameChanged}
                className={smallButton}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          conversation.description && (
            <p className="mb-4 text-sm text-app-muted">{conversation.description}</p>
          )
        )}

        <p className="mb-1 text-xs font-semibold text-app-muted">
          Members · {conversation.members.length}
        </p>
        <ul
          data-lenis-prevent
          className="mb-3 min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {membersByRank(conversation.members, conversation.createdBy).map((member) => {
            const isCreator = member.userId === conversation.createdBy;
            const changeAdmin =
              !archived && canChangeAdmin(authority, member, conversation.createdBy);
            const remove =
              !archived && canRemoveMember(authority, member, conversation.createdBy);
            return (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-2 py-1.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar
                    name={member.fullName}
                    seed={member.userId}
                    presence={presence[member.userId]}
                    size="xs"
                  />
                  <span className="truncate">
                    {member.fullName}
                    {member.userId === currentUserId && (
                      <span className="text-app-muted"> (you)</span>
                    )}
                  </span>
                  {(isCreator || member.role === 'admin') && (
                    <span className="shrink-0 rounded-full bg-app-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-app-accent">
                      {isCreator ? 'Creator' : 'Admin'}
                    </span>
                  )}
                </span>
                {confirmRemoveId === member.userId ? (
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    <span className="text-app-muted">Remove from group?</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => removeGroupMember(conversation.id, member.userId),
                          () => setConfirmRemoveId(null),
                        )
                      }
                      className="font-semibold text-app-danger hover:underline"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(null)}
                      className="text-app-muted hover:underline"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  (changeAdmin || remove) && (
                    <span className="flex shrink-0 items-center gap-3 text-xs">
                      {changeAdmin && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              setGroupMemberRole(
                                conversation.id,
                                member.userId,
                                member.role === 'admin' ? 'member' : 'admin',
                              ),
                            )
                          }
                          className="text-app-accent hover:underline"
                        >
                          {member.role === 'admin' ? 'Remove admin' : 'Make admin'}
                        </button>
                      )}
                      {remove && (
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(member.userId)}
                          className="text-app-danger hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>

        {canEdit && addable.length > 0 && (
          <div className="mb-3 flex gap-2">
            <select
              value={addingMemberId}
              onChange={(event) => setAddingMemberId(event.target.value)}
              aria-label="Add a member"
              className="min-w-0 flex-1 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm outline-none focus:border-app-accent"
            >
              <option value="">Add a member…</option>
              {addable.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </select>
            <Button
              kind="secondary"
              onClick={() =>
                void run(
                  () => addGroupMembers(conversation.id, [addingMemberId]),
                  () => setAddingMemberId(''),
                )
              }
              disabled={busy || !addingMemberId}
              className={smallButton}
            >
              Add
            </Button>
          </div>
        )}

        {authority === 'owner' && confirmDelete && (
          <div className="mb-3 rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 p-3">
            <p className="text-sm font-semibold text-app-danger">
              Delete “{conversation.name}” for everyone?
            </p>
            <p className="mt-1 text-xs text-app-muted">
              It disappears from every member’s list and can’t be opened again. Its
              messages are kept on record.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                kind="secondary"
                onClick={() => setConfirmDelete(false)}
                className={smallButton}
              >
                Cancel
              </Button>
              <Button
                kind="danger"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => deleteGroup(conversation.id),
                    () => onLeftView(`“${conversation.name}” was deleted.`),
                  )
                }
                className={smallButton}
              >
                Delete group
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {authority === 'owner' ? (
            <div className="flex gap-2">
              {archived ? (
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => restoreGroup(conversation.id),
                      () =>
                        onLeftView(
                          `“${conversation.name}” is back in your active groups.`,
                        ),
                    )
                  }
                  className={smallButton}
                >
                  Restore group
                </Button>
              ) : (
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => archiveGroup(conversation.id),
                      () =>
                        onLeftView(
                          `“${conversation.name}” was archived. Find it under Archived.`,
                        ),
                    )
                  }
                  className={smallButton}
                >
                  Archive group
                </Button>
              )}
              {!confirmDelete && (
                <Button
                  kind="danger"
                  onClick={() => setConfirmDelete(true)}
                  className={smallButton}
                >
                  Delete group
                </Button>
              )}
            </div>
          ) : (
            <span />
          )}
          <Button kind="secondary" onClick={onClose} className={smallButton}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
