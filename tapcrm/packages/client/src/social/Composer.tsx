import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, Field, Notice, Select } from '../ui/components.js';
import { Icon } from '../ui/Icon.js';
import { actOnSocialPost, saveSocialPost, uploadSocialMedia } from './api.js';
import { PlatformMark, SocialEmpty, socialDate } from './presentation.js';
import { scheduleInZone, scheduleToUtc } from './time.js';
import { validateSocialFile, validateSocialPost } from './validation.js';
import {
  PLATFORM_LABELS,
  type SocialAccount,
  type SocialMedia,
  type SocialPost,
  type SocialPostInput,
  type SocialSettings,
} from './types.js';

export function Composer({
  clientId,
  accounts,
  settings,
  post,
  canPublish,
  onSaved,
  onAccounts,
}: {
  clientId: string;
  accounts: SocialAccount[];
  settings: SocialSettings;
  post?: SocialPost;
  canPublish: boolean;
  onSaved: (post: SocialPost) => void;
  onAccounts: () => void;
}): React.JSX.Element {
  const connected = accounts.filter((account) => account.status === 'connected');
  const [caption, setCaption] = useState(post?.caption ?? '');
  const [title, setTitle] = useState(post?.title ?? '');
  const [link, setLink] = useState(post?.link ?? '');
  const [accountIds, setAccountIds] = useState<string[]>(
    post?.destinations.map((item) => item.accountId) ?? [],
  );
  const [media, setMedia] = useState<SocialMedia[]>(post?.media ?? []);
  const [sharedMediaIds, setSharedMediaIds] = useState<string[]>(
    post?.sharedMediaIds ?? post?.media.map((item) => item.id) ?? [],
  );
  function removeMedia(id: string) {
    setMedia((current) => current.filter((item) => item.id !== id));
    setSharedMediaIds((current) => current.filter((item) => item !== id));
    setOverrides((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, value]) => [
          key,
          {
            ...value,
            ...(value.mediaIds
              ? { mediaIds: value.mediaIds.filter((item) => item !== id) }
              : {}),
          },
        ]),
      ),
    );
  }
  const [overrides, setOverrides] = useState<NonNullable<SocialPostInput['overrides']>>(
    Object.fromEntries(
      post?.destinations.map((item) => [
        item.accountId,
        {
          caption: item.caption,
          title: item.title ?? '',
          link: item.link ?? '',
          mediaIds: item.mediaIds,
        },
      ]) ?? [],
    ),
  );
  const [previewAccountId, setPreviewAccountId] = useState(
    post?.destinations[0]?.accountId ?? '',
  );
  const [schedule, setSchedule] = useState(
    post?.scheduledAt ? scheduleInZone(post.scheduledAt, settings.timezone) : '',
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const selectedAccounts = accounts.filter((account) => accountIds.includes(account.id));
  const preview =
    selectedAccounts.find((account) => account.id === previewAccountId) ??
    selectedAccounts[0];
  const input: SocialPostInput = {
    caption,
    ...(title ? { title } : {}),
    ...(link ? { link } : {}),
    accountIds,
    mediaIds: sharedMediaIds,
    overrides: Object.fromEntries(
      Object.entries(overrides)
        .filter(([id]) => accountIds.includes(id))
        .map(([id, override]) => [
          id,
          {
            ...override,
          },
        ]),
    ),
    intent: 'draft',
  };
  const validation = validateSocialPost(input, accounts, media);
  const previewOverride = preview ? overrides[preview.id] : undefined;
  const previewMedia = previewOverride?.mediaIds
    ? media.filter((item) => previewOverride.mediaIds!.includes(item.id))
    : media.filter((item) => sharedMediaIds.includes(item.id));

  function toggleAccount(id: string): void {
    setAccountIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setPreviewAccountId(id);
  }
  async function upload(files: FileList | null): Promise<void> {
    if (!files) return;
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        const fileError = validateSocialFile(file);
        if (fileError) throw new Error(`${file.name}: ${fileError}`);
        const result = await uploadSocialMedia(clientId, file);
        setMedia((current) => [...current, result]);
        setSharedMediaIds((current) => [...current, result.id]);
      }
      toast.success('Media uploaded');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Media upload failed.');
    } finally {
      setUploading(false);
    }
  }
  async function save(intent: SocialPostInput['intent']): Promise<void> {
    setBusy(true);
    setError('');
    try {
      if (intent !== 'draft' && validation.length) throw new Error(validation[0]);
      let scheduledAt: string | undefined;
      if (intent === 'schedule') {
        scheduledAt = scheduleToUtc(schedule, settings.timezone);
        if (Date.parse(scheduledAt) <= Date.now())
          throw new Error('Choose a publishing time in the future.');
      }
      const saved = await saveSocialPost(
        clientId,
        { ...input, intent: intent === 'submit' ? 'submit' : 'draft' },
        post?.id,
      );
      if (intent === 'publish' || intent === 'schedule') {
        try {
          const queued = await actOnSocialPost(
            clientId,
            saved.id,
            intent,
            scheduledAt ? { scheduledAt } : {},
          );
          toast.success(
            intent === 'schedule' ? 'Post scheduled' : 'Post queued for publishing',
          );
          onSaved(queued);
        } catch (cause) {
          toast.error(
            `Draft saved. ${cause instanceof Error ? cause.message : 'Publishing could not be queued.'}`,
          );
          onSaved(saved);
        }
      } else {
        toast.success(
          intent === 'submit' ? 'Post submitted for approval' : 'Draft saved',
        );
        onSaved(saved);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save this post.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(17rem,0.75fr)]">
      <div className="space-y-5">
        <Card>
          <h2 className="font-semibold">{post ? 'Edit post' : 'Create a post'}</h2>
          {!connected.length && (
            <Notice>
              Save a draft now, then connect a client account before submitting or
              publishing.{' '}
              <button
                type="button"
                className="font-semibold underline"
                onClick={onAccounts}
              >
                Connected accounts
              </button>
            </Notice>
          )}
          {selectedAccounts.some((account) => account.platform === 'youtube') && (
            <Notice>
              YouTube videos upload as private in this release. Change visibility in
              YouTube after reviewing the completed upload.
            </Notice>
          )}
          <p className="mt-1 text-sm text-app-muted">
            Choose your destinations, then tailor the message for each account.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {connected.map((account) => (
              <label
                key={account.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${accountIds.includes(account.id) ? 'border-app-accent bg-app-accent/5' : 'border-app-border'}`}
              >
                <input
                  type="checkbox"
                  checked={accountIds.includes(account.id)}
                  onChange={() => toggleAccount(account.id)}
                  className="accent-app-accent"
                />
                <PlatformMark platform={account.platform} small />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {account.name}
                  </span>
                  <span className="text-xs text-app-muted">
                    {PLATFORM_LABELS[account.platform]}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Card>
        <Card className="space-y-4">
          <label className="block text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Caption</span>
            <textarea
              rows={7}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="What would you like to share? Add your message, links and #hashtags…"
              className="w-full resize-y rounded-xl border border-app-border bg-app-background p-3 text-sm leading-6 text-app-foreground outline-none focus:border-app-accent"
            />
            <span className="mt-1 block text-right font-normal">
              {caption.length.toLocaleString()} characters
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Title (required for YouTube)"
              value={title}
              onChange={setTitle}
              placeholder="Video title"
            />
            <Field
              label="Link (optional)"
              value={link}
              onChange={setLink}
              type="url"
              placeholder="https://…"
            />
          </div>
          <div className="rounded-xl border border-dashed border-app-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Images & video</h3>
                <p className="mt-1 text-xs text-app-muted">
                  JPEG / PNG up to 8 MB · MP4 up to 50 MB
                </p>
              </div>
              <label
                className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-app-border px-3 py-2 text-sm font-semibold ${uploading ? 'pointer-events-none opacity-50' : ''}`}
              >
                <Icon name="plus" className="size-4" />
                {uploading ? 'Uploading…' : 'Add media'}
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,video/mp4"
                  multiple
                  disabled={busy || uploading}
                  onChange={(event) => {
                    void upload(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
            </div>
            {media.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((item) => (
                  <div
                    key={item.id}
                    className="overflow-hidden rounded-lg border border-app-border"
                  >
                    {item.mimeType.startsWith('video/') ? (
                      <video
                        src={item.url}
                        controls
                        preload="metadata"
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <img
                        src={item.url}
                        alt={item.name}
                        className="aspect-square w-full object-cover"
                      />
                    )}
                    <div className="flex items-center gap-2 p-2">
                      <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        disabled={busy}
                        onClick={() => removeMedia(item.id)}
                        className="text-app-muted hover:text-app-danger"
                      >
                        <Icon name="close" className="size-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {selectedAccounts.length > 0 && (
            <details className="rounded-xl border border-app-border p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Customize by destination
              </summary>
              <div className="mt-4 space-y-5">
                {selectedAccounts.map((account) => (
                  <div key={account.id} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <PlatformMark platform={account.platform} small />
                      <h3 className="text-sm font-semibold">{account.name}</h3>
                      <button
                        className="ml-auto text-xs text-app-accent"
                        type="button"
                        onClick={() =>
                          setOverrides((current) => {
                            const next = { ...current };
                            delete next[account.id];
                            return next;
                          })
                        }
                      >
                        Use shared content
                      </button>
                    </div>
                    <label className="block text-xs text-app-muted">
                      Caption
                      <textarea
                        rows={3}
                        value={overrides[account.id]?.caption ?? caption}
                        onChange={(event) =>
                          setOverrides((current) => ({
                            ...current,
                            [account.id]: {
                              ...current[account.id],
                              caption: event.target.value,
                            },
                          }))
                        }
                        className="mt-2 w-full rounded-lg border border-app-border bg-app-background p-3 text-sm text-app-foreground outline-none focus:border-app-accent"
                      />
                    </label>
                    {account.platform === 'youtube' && (
                      <Field
                        label="Video title"
                        value={overrides[account.id]?.title ?? title}
                        onChange={(value) =>
                          setOverrides((current) => ({
                            ...current,
                            [account.id]: { ...current[account.id], title: value },
                          }))
                        }
                      />
                    )}
                    {account.platform === 'instagram' && (
                      <Select
                        label="Instagram placement"
                        value={overrides[account.id]?.postType ?? 'feed'}
                        onChange={(value) =>
                          setOverrides((current) => ({
                            ...current,
                            [account.id]: {
                              ...current[account.id],
                              postType: value === 'story' ? 'story' : 'feed',
                            },
                          }))
                        }
                        options={[
                          { value: 'feed', label: 'Feed post / Reel' },
                          { value: 'story', label: 'Story (one image or video)' },
                        ]}
                      />
                    )}
                    <Field
                      label="Destination link"
                      value={overrides[account.id]?.link ?? link}
                      onChange={(value) =>
                        setOverrides((current) => ({
                          ...current,
                          [account.id]: { ...current[account.id], link: value },
                        }))
                      }
                    />
                    {media.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {media.map((item) => (
                          <label
                            key={item.id}
                            className="flex items-center gap-2 rounded-lg bg-app-surface-raised p-2 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={(
                                overrides[account.id]?.mediaIds ?? sharedMediaIds
                              ).includes(item.id)}
                              onChange={(event) =>
                                setOverrides((current) => {
                                  const existing =
                                    current[account.id]?.mediaIds ?? sharedMediaIds;
                                  return {
                                    ...current,
                                    [account.id]: {
                                      ...current[account.id],
                                      mediaIds: event.target.checked
                                        ? [...existing, item.id]
                                        : existing.filter((id) => id !== item.id),
                                    },
                                  };
                                })
                              }
                            />
                            <span className="max-w-32 truncate">{item.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </Card>
        <Card className="space-y-4">
          {error && <Notice error>{error}</Notice>}
          {accountIds.length > 0 && validation.length > 0 && (
            <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              <p className="font-semibold">Before publishing</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {validation.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}
          {settings.approvalRequired && (
            <p className="text-sm text-app-muted">
              <Icon name="shield" className="mr-1 inline size-4" />
              This client requires approval before publishing. Changes to an approved post
              require another review.
            </p>
          )}
          <Field
            label={`Schedule date & time · ${settings.timezone}`}
            type="datetime-local"
            value={schedule}
            onChange={setSchedule}
          />
          {schedule &&
            (() => {
              try {
                return (
                  <p className="text-xs text-app-muted">
                    Publishing time:{' '}
                    {socialDate(
                      scheduleToUtc(schedule, settings.timezone),
                      settings.timezone,
                    )}
                  </p>
                );
              } catch {
                return null;
              }
            })()}
          <div className="flex flex-wrap gap-2">
            <Button
              kind="secondary"
              disabled={busy || uploading}
              onClick={() => void save('draft')}
            >
              Save draft
            </Button>
            <Button
              kind="secondary"
              disabled={busy || uploading || validation.length > 0}
              onClick={() => void save('submit')}
            >
              Submit for approval
            </Button>
            {canPublish && !settings.approvalRequired && (
              <>
                <Button
                  kind="secondary"
                  disabled={busy || uploading || validation.length > 0 || !schedule}
                  onClick={() => void save('schedule')}
                >
                  Schedule post
                </Button>
                <Button
                  disabled={busy || uploading || validation.length > 0}
                  onClick={() => void save('publish')}
                >
                  {busy ? 'Saving…' : 'Publish now'}
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>
      <Card className="xl:sticky xl:top-6">
        <div className="flex items-center gap-2">
          <Icon name="eye" className="size-4 text-app-muted" />
          <h2 className="text-sm font-semibold">Post preview</h2>
        </div>
        <p className="mt-1 text-xs text-app-muted">
          An approximation. Each platform may display your content differently.
        </p>
        {preview ? (
          <>
            <div className="mt-4">
              <Select
                label="Preview destination"
                value={preview.id}
                onChange={setPreviewAccountId}
                options={selectedAccounts.map((account) => ({
                  value: account.id,
                  label: `${PLATFORM_LABELS[account.platform]} · ${account.name}`,
                }))}
              />
            </div>
            <div className="mt-5 overflow-hidden rounded-xl border border-app-border">
              <div className="flex items-center gap-3 p-4">
                <PlatformMark platform={preview.platform} />
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{preview.name}</h3>
                  <p className="text-xs text-app-muted">
                    {preview.platform === 'linkedin' ? 'Just now · Public' : 'Just now'}
                  </p>
                </div>
                <Icon name="more" className="ml-auto size-4" />
              </div>
              {preview.platform === 'youtube' && (
                <h4 className="px-4 pb-2 font-semibold">
                  {previewOverride?.title ?? title}
                </h4>
              )}
              <p className="whitespace-pre-wrap break-words px-4 pb-4 text-sm leading-6">
                {(previewOverride?.caption ?? caption) ||
                  'Your caption will appear here.'}
              </p>
              {previewMedia.map((item) =>
                item.mimeType.startsWith('video/') ? (
                  <video key={item.id} src={item.url} controls className="w-full" />
                ) : (
                  <img
                    key={item.id}
                    src={item.url}
                    alt={item.name}
                    className="max-h-80 w-full object-contain"
                  />
                ),
              )}
              {(previewOverride?.link ?? link) && (
                <p className="break-all bg-app-surface-raised p-3 text-xs text-app-muted">
                  {previewOverride?.link ?? link}
                </p>
              )}
              <div className="flex justify-between border-t border-app-border p-3 text-xs text-app-muted">
                <span>{preview.platform === 'youtube' ? 'Like' : 'Like · Comment'}</span>
                <span>Share</span>
              </div>
            </div>
          </>
        ) : (
          <SocialEmpty
            title="Select a destination"
            description="Your preview updates as you add content and connected accounts."
          />
        )}
      </Card>
    </div>
  );
}
