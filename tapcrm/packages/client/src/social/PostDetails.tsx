import { getIdentitySessionSnapshot } from '../identity/api/authApi.js';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Field, Modal, Notice } from '../ui/components.js';
import { actOnSocialPost } from './api.js';
import { PlatformMark, PostStatus, socialDate } from './presentation.js';
import { scheduleInZone, scheduleToUtc } from './time.js';
import type { SocialPost, SocialPostAction } from './types.js';

export function PostDetails({
  post,
  timezone,
  canManage,
  canApprove,
  canPublish,
  onClose,
  onChanged,
  onEdit,
}: {
  post: SocialPost;
  timezone: string;
  canManage: boolean;
  canApprove: boolean;
  canPublish: boolean;
  onClose: () => void;
  onChanged: (post: SocialPost) => void;
  onEdit: (post: SocialPost) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [schedule, setSchedule] = useState(
    post.scheduledAt ? scheduleInZone(post.scheduledAt, timezone) : '',
  );
  const [confirmCancel, setConfirmCancel] = useState(false);
  async function act(action: SocialPostAction): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const extra: { comment?: string; scheduledAt?: string } = {};
      if (action === 'schedule') {
        extra.scheduledAt = scheduleToUtc(schedule, timezone);
        if (Date.parse(extra.scheduledAt) <= Date.now())
          throw new Error('Choose a publishing time in the future.');
      }
      if (action === 'approve' || action === 'request_changes') extra.comment = comment;
      const updated = await actOnSocialPost(post.clientId, post.id, action, extra);
      toast.success(
        action === 'duplicate' ? 'Post duplicated as a draft' : 'Post updated',
      );
      onChanged(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update this post.');
    } finally {
      setBusy(false);
    }
  }
  const editable =
    ['draft', 'approved'].includes(post.status) &&
    !post.destinations.some((item) =>
      ['published', 'publishing', 'outcome_unknown'].includes(item.status),
    );
  const eligible =
    ['draft', 'approved', 'scheduled'].includes(post.status) &&
    post.destinations.every((item) => item.attempts === 0) &&
    (!post.approvalRequired || post.approvedAt !== null);
  return (
    <Modal title="Post details" size="lg" onClose={onClose} dirty={false}>
      <div className="space-y-5">
        {error && <Notice error>{error}</Notice>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PostStatus status={post.status} />
          <p className="text-xs text-app-muted">
            Created by {post.createdByName} · {socialDate(post.createdAt, timezone)}
          </p>
        </div>
        {post.title && <h3 className="font-semibold">{post.title}</h3>}
        <p className="whitespace-pre-wrap break-words text-sm leading-6">
          {post.caption || 'No shared caption'}
        </p>
        {post.link && <p className="break-all text-xs text-app-muted">{post.link}</p>}
        {post.media.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {post.media.map((item) =>
              item.mimeType.startsWith('video/') ? (
                <video
                  key={item.id}
                  src={item.url}
                  controls
                  className="max-h-64 w-full rounded-lg"
                />
              ) : (
                <img
                  key={item.id}
                  src={item.url}
                  alt={item.name}
                  className="max-h-64 w-full rounded-lg object-contain"
                />
              ),
            )}
          </div>
        )}
        <div className="rounded-xl border border-app-border p-4">
          <h3 className="text-sm font-semibold">Publishing destinations</h3>
          <div className="mt-3 divide-y divide-app-border">
            {post.destinations.map((item) => (
              <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <PlatformMark platform={item.platform} small />
                  <span className="flex-1 text-sm font-semibold">{item.accountName}</span>
                  <PostStatus status={item.status} />
                </div>
                {item.caption !== post.caption && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-app-muted">
                    {item.caption}
                  </p>
                )}
                {item.error && (
                  <p className="mt-2 text-xs leading-5 text-app-danger">{item.error}</p>
                )}
                {item.status === 'outcome_unknown' && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-200">
                    Check the platform before creating another post. The publishing result
                    could not be confirmed.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-app-muted">
                  <span>
                    {item.attempts} attempt{item.attempts === 1 ? '' : 's'}
                    {item.nextAttemptAt
                      ? ` · Next retry ${socialDate(item.nextAttemptAt, timezone)}`
                      : ''}
                  </span>
                  {item.platformPostUrl && (
                    <a
                      href={item.platformPostUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-app-accent"
                    >
                      View on platform ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-2 text-xs text-app-muted sm:grid-cols-2">
          <p>Scheduled: {socialDate(post.scheduledAt, timezone)}</p>
          <p>
            Published:{' '}
            {post.publishedAt ? socialDate(post.publishedAt, timezone) : 'Not published'}
          </p>
          <p>Timezone: {timezone}</p>
        </div>
        {post.approvals.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold">Approval history</h3>
            <ol className="mt-3 space-y-3 border-l border-app-border pl-4">
              {post.approvals.map((approval) => (
                <li key={approval.id}>
                  <p className="text-xs font-semibold">
                    {approval.actorName} · {approval.decision.replaceAll('_', ' ')}
                  </p>
                  {approval.comment && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-app-muted">
                      {approval.comment}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-app-muted">
                    {socialDate(approval.createdAt, timezone)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}
        {canApprove &&
          getIdentitySessionSnapshot().principalId !== post.createdBy &&
          post.status === 'pending_approval' && (
            <div className="space-y-3 rounded-xl border border-app-border p-4">
              <Field
                label="Reviewer comment"
                value={comment}
                onChange={setComment}
                placeholder="Add feedback for the author"
              />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void act('approve')}>
                  Approve
                </Button>
                <Button
                  kind="secondary"
                  disabled={busy || !comment.trim()}
                  onClick={() => void act('request_changes')}
                >
                  Request changes
                </Button>
              </div>
            </div>
          )}
        {canPublish && eligible && (
          <div className="space-y-3 rounded-xl border border-app-border p-4">
            <Field
              label={`Publish at · ${timezone}`}
              type="datetime-local"
              value={schedule}
              onChange={setSchedule}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                kind="secondary"
                disabled={busy || !schedule}
                onClick={() => void act('schedule')}
              >
                {post.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
              </Button>
              {post.status !== 'scheduled' && (
                <Button disabled={busy} onClick={() => void act('publish')}>
                  Publish now
                </Button>
              )}
            </div>
          </div>
        )}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button kind="secondary" disabled={busy} onClick={() => onEdit(post)}>
                Edit post
              </Button>
            )}
            <Button
              kind="secondary"
              disabled={busy}
              onClick={() => void act('duplicate')}
            >
              Duplicate
            </Button>
            {['draft', 'approved'].includes(post.status) && (
              <Button kind="secondary" disabled={busy} onClick={() => void act('submit')}>
                Submit for approval
              </Button>
            )}
            {['scheduled', 'pending_approval', 'draft', 'approved'].includes(
              post.status,
            ) && (
              <Button
                kind="danger"
                disabled={busy}
                onClick={() => setConfirmCancel(true)}
              >
                Cancel post
              </Button>
            )}
          </div>
        )}
        {confirmCancel && (
          <Notice>
            <p>Cancel this post and its unpublished destinations?</p>
            <div className="mt-3 flex gap-2">
              <Button kind="danger" disabled={busy} onClick={() => void act('cancel')}>
                Confirm cancellation
              </Button>
              <Button
                kind="secondary"
                disabled={busy}
                onClick={() => setConfirmCancel(false)}
              >
                Keep post
              </Button>
            </div>
          </Notice>
        )}
      </div>
    </Modal>
  );
}
