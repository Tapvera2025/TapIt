import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, Field, Notice, Select, SkeletonTable } from '../ui/index.js';
import {
  PeopleCalendar,
  setCalendarDragPayload,
  type CalendarDragPayload,
  type PeopleCalendarDay,
} from '../ui/index.js';
import { calendarMonth, calendarWeek } from '../ui/index.js';
import { actOnSocialPost, listSocialPosts } from './api.js';
import {
  dateInZone,
  PlatformMark,
  PostStatus,
  SocialEmpty,
  socialDate,
} from './presentation.js';
import { scheduleInZone, scheduleToUtc } from './time.js';
import {
  PLATFORM_LABELS,
  STATUS_LABELS,
  type SocialPost,
  type SocialPostPage,
} from './types.js';

const DRAG_TYPE = 'social-post';

/** A scheduled post is draggable only if the publishing worker hasn't claimed any destination yet. */
function isReschedulable(post: SocialPost): boolean {
  if (post.status !== 'scheduled') return false;
  return post.destinations.every(
    (destination) => destination.attempts === 0 && destination.status !== 'published',
  );
}

export function Planner({
  clientId,
  clientName,
  timezone,
  section,
  canManage,
  canPublish,
  onPost,
  onCreate,
  revision,
}: {
  clientId: string;
  clientName: string;
  timezone: string;
  section: string;
  canManage: boolean;
  canPublish: boolean;
  onPost: (post: SocialPost) => void;
  onCreate: () => void;
  revision: number;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [platform, setPlatform] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SocialPostPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const today = dateInZone(new Date().toISOString(), timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [calendarView, setCalendarView] = useState<'month' | 'week'>('month');
  const calendar = section === 'calendar';
  const sectionStatus =
    section === 'approvals'
      ? 'pending_approval'
      : status ||
        (section === 'published' ? 'published' : section === 'drafts' ? 'draft' : '');

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [
    clientId,
    section,
    appliedSearch,
    status,
    platform,
    from,
    to,
    sort,
    month,
    calendarView,
    selectedDate,
  ]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    const days =
      calendarView === 'week' ? calendarWeek(selectedDate) : calendarMonth(month);
    const query: Record<string, string> = {
      search: appliedSearch,
      status: sectionStatus,
      platform,
      sort,
      page: String(calendar ? 1 : page),
      pageSize: calendar ? '100' : '15',
      from: calendar ? days[0]! : from,
      to: calendar ? days.at(-1)! : to,
    };
    async function load(): Promise<void> {
      try {
        const first = await listSocialPosts(clientId, query);
        if (cancelled) return;
        let result = first;
        if (calendar) {
          const items = [...first.items];
          for (let next = 2; next <= first.totalPages; next += 1) {
            const part = await listSocialPosts(clientId, {
              ...query,
              page: String(next),
            });
            if (cancelled) return;
            items.push(...part.items);
          }
          result = { ...first, items };
        }
        setData(result);
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Unable to load posts.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    clientId,
    section,
    appliedSearch,
    sectionStatus,
    status,
    platform,
    sort,
    page,
    from,
    to,
    month,
    calendarView,
    selectedDate,
    calendar,
    revision,
    reload,
  ]);

  async function rescheduleToDate(
    payload: CalendarDragPayload,
    targetDate: string,
  ): Promise<void> {
    const target = posts.find((item) => item.id === payload.id);
    if (!target || !isReschedulable(target)) {
      toast.error('Only scheduled posts without publishing attempts can be moved.');
      return;
    }
    const current = target.scheduledAt
      ? scheduleInZone(target.scheduledAt, timezone)
      : `${targetDate}T09:00`;
    const nextLocal = `${targetDate}T${current.slice(11, 16)}`;
    let scheduledAt: string;
    try {
      scheduledAt = scheduleToUtc(nextLocal, timezone);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'That time is not valid.');
      return;
    }
    if (Date.parse(scheduledAt) <= Date.now()) {
      toast.error('Choose a future date for scheduled posts.');
      return;
    }
    try {
      await actOnSocialPost(clientId, target.id, 'schedule', { scheduledAt });
      toast.success(`Rescheduled to ${targetDate}`);
      setSelectedDate(targetDate);
      setReload((value) => value + 1);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to reschedule.');
    }
  }
  async function duplicateSelected(): Promise<void> {
    setBulkBusy(true);
    let succeeded = 0;
    try {
      for (const id of selectedIds) {
        await actOnSocialPost(clientId, id, 'duplicate');
        succeeded += 1;
      }
      toast.success(
        `${succeeded} post${succeeded === 1 ? '' : 's'} duplicated as drafts`,
      );
      setSelectedIds([]);
    } catch (cause) {
      toast.error(
        `${succeeded} duplicated. ${cause instanceof Error ? cause.message : 'Unable to complete the selection.'}`,
      );
    } finally {
      setBulkBusy(false);
      setReload((value) => value + 1);
    }
  }
  const posts = data?.items ?? [];
  const byDate = new Map<string, SocialPost[]>();
  for (const post of posts) {
    const date = dateInZone(
      post.scheduledAt ?? post.publishedAt ?? post.createdAt,
      timezone,
    );
    byDate.set(date, [...(byDate.get(date) ?? []), post]);
  }
  const calendarDays: PeopleCalendarDay[] = [...byDate.entries()].map(
    ([date, entries]) => ({
      date,
      label: `${entries.length} post${entries.length === 1 ? '' : 's'}`,
      tone: entries.some((post) => post.status === 'failed')
        ? 'negative'
        : entries.some((post) => post.status === 'pending_approval')
          ? 'warning'
          : 'neutral',
      markers: entries
        .slice(0, 3)
        .map(
          (post) =>
            `${STATUS_LABELS[post.status]} · ${post.caption.slice(0, 35) || post.title || 'Media post'}`,
        ),
    }),
  );
  const datePosts = byDate.get(selectedDate) ?? [];
  return (
    <div className="space-y-5">
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedSearch(search);
            setReload((value) => value + 1);
          }}
          className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field
            label="Search posts"
            value={search}
            onChange={setSearch}
            placeholder="Search captions…"
          />
          <Select
            label="Platform"
            value={platform}
            onChange={setPlatform}
            options={Object.entries(PLATFORM_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Select
            label="Status"
            value={sectionStatus}
            onChange={setStatus}
            disabled={section === 'approvals'}
            options={Object.entries(STATUS_LABELS)
              .filter(
                ([value]) =>
                  section !== 'drafts' ||
                  ['draft', 'scheduled', 'approved', 'pending_approval'].includes(value),
              )
              .map(([value, label]) => ({ value, label }))}
          />
          <div className="flex gap-2">
            <Button type="submit" kind="secondary" className="flex-1">
              Search
            </Button>
            <Button
              kind="secondary"
              onClick={() => {
                setSearch('');
                setAppliedSearch('');
                setStatus('');
                setPlatform('');
                setFrom('');
                setTo('');
                setSort('newest');
              }}
            >
              Reset
            </Button>
          </div>
          {!calendar && (
            <>
              <Field label="From date" type="date" value={from} onChange={setFrom} />
              <Field label="To date" type="date" value={to} onChange={setTo} />
              <Select
                label="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'newest', label: 'Newest first' },
                  { value: 'oldest', label: 'Oldest first' },
                ]}
              />
              <p className="pb-3 text-xs text-app-muted">
                All dates shown in {timezone}.
              </p>
            </>
          )}
        </form>
      </Card>
      {error && (
        <Notice error>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button kind="secondary" onClick={() => setReload((value) => value + 1)}>
              Try again
            </Button>
          </div>
        </Notice>
      )}
      {loading ? (
        <SkeletonTable columns={6} rows={5} />
      ) : calendar ? (
        <>
          <PeopleCalendar
            month={month}
            selectedDate={selectedDate}
            days={calendarDays}
            view={calendarView}
            onMonthChange={setMonth}
            onSelectDate={setSelectedDate}
            onViewChange={setCalendarView}
            idPrefix="social-calendar"
            title="Content calendar"
            emptyLabel="No posts"
            detailHint="Tap a date to view its planned content."
            resourceLabel="content"
            dropPayloadType={DRAG_TYPE}
            {...(canPublish
              ? {
                  onDropOnDate: (date, payload) => void rescheduleToDate(payload, date),
                }
              : {})}
          />
          <Card>
            <div className="flex flex-wrap justify-between gap-2">
              <h2 className="font-semibold">Content for {selectedDate}</h2>
              <p className="text-xs text-app-muted">
                {timezone} · Drafts appear on their creation date.
                {canPublish && ' Drag a scheduled post onto a date to reschedule.'}
              </p>
            </div>
            {datePosts.length ? (
              <div className="mt-4 space-y-2">
                {datePosts.map((post) => {
                  const draggable = canPublish && isReschedulable(post);
                  return (
                    <button
                      key={post.id}
                      type="button"
                      onClick={() => onPost(post)}
                      draggable={draggable}
                      onDragStart={
                        draggable
                          ? (event) =>
                              setCalendarDragPayload(event, {
                                type: DRAG_TYPE,
                                id: post.id,
                                fromDate: selectedDate,
                              })
                          : undefined
                      }
                      className={`flex w-full flex-wrap items-center gap-3 rounded-xl border border-app-border p-3 text-left hover:border-app-accent ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    >
                      <span className="flex gap-1">
                        {post.destinations.map((destination) => (
                          <PlatformMark
                            key={destination.id}
                            platform={destination.platform}
                            small
                          />
                        ))}
                      </span>
                      <span className="min-w-32 flex-1 truncate text-sm">
                        {post.caption || post.title || 'Media post'}
                      </span>
                      <PostStatus status={post.status} />
                      <span className="text-xs text-app-muted">
                        {socialDate(
                          post.scheduledAt ?? post.publishedAt ?? post.createdAt,
                          timezone,
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <SocialEmpty
                title="A clear day on your calendar"
                description="Choose another date to view content, or start planning a new post."
                action={canManage && <Button onClick={onCreate}>Create post</Button>}
              />
            )}
          </Card>
        </>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border px-4 py-3">
            <p className="text-sm text-app-muted">{`${data?.total ?? 0} post${data?.total === 1 ? '' : 's'}`}</p>
            {canManage && selectedIds.length > 0 && (
              <Button
                kind="secondary"
                disabled={bulkBusy}
                onClick={() => void duplicateSelected()}
              >
                Duplicate {selectedIds.length} selected
              </Button>
            )}
          </div>
          {posts.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-app-surface-raised text-[11px] uppercase tracking-wide text-app-muted">
                  <tr>
                    {canManage && (
                      <th className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select all posts on this page"
                          checked={
                            posts.length > 0 &&
                            posts.every((post) => selectedIds.includes(post.id))
                          }
                          onChange={(event) =>
                            setSelectedIds(
                              event.target.checked ? posts.map((post) => post.id) : [],
                            )
                          }
                        />
                      </th>
                    )}
                    <th className="px-4 py-3">Content</th>
                    <th className="px-4 py-3">Destinations</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Created by</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border">
                  {posts.map((post) => (
                    <tr key={post.id} className="hover:bg-app-surface-raised/50">
                      {canManage && (
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            aria-label={`Select post ${post.caption.slice(0, 30) || post.id}`}
                            checked={selectedIds.includes(post.id)}
                            onChange={(event) =>
                              setSelectedIds((current) =>
                                event.target.checked
                                  ? [...current, post.id]
                                  : current.filter((id) => id !== post.id),
                              )
                            }
                          />
                        </td>
                      )}
                      <td className="max-w-80 px-4 py-4">
                        <button
                          type="button"
                          onClick={() => onPost(post)}
                          className="flex items-center gap-3 text-left"
                        >
                          {post.media[0] && (
                            <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-app-surface-raised">
                              {post.media[0].mimeType.startsWith('image/') ? (
                                <img
                                  src={post.media[0].url}
                                  alt=""
                                  className="size-full object-cover"
                                />
                              ) : (
                                <span className="text-xs">Video</span>
                              )}
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="line-clamp-2 font-semibold hover:text-app-accent">
                              {post.caption || post.title || 'Media post'}
                            </span>
                            <span className="mt-1 block text-xs text-app-muted">
                              {clientName}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex gap-1">
                          {post.destinations.map((destination) => (
                            <PlatformMark
                              key={destination.id}
                              platform={destination.platform}
                              small
                            />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <PostStatus status={post.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-app-muted">
                        {socialDate(
                          post.scheduledAt ?? post.publishedAt ?? post.createdAt,
                          timezone,
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs text-app-muted">
                        {post.createdByName}
                      </td>
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={() => onPost(post)}
                          className="text-xs font-semibold text-app-accent"
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <SocialEmpty
              title={
                section === 'approvals' ? 'No posts awaiting review' : 'No posts to show'
              }
              description={
                appliedSearch || platform || status
                  ? 'Try a different search or clear your filters.'
                  : 'Create a draft, schedule content or publish to a connected account to see it here.'
              }
              action={canManage && <Button onClick={onCreate}>Create post</Button>}
            />
          )}
          <div className="flex items-center justify-between gap-3 border-t border-app-border p-4">
            <span className="text-xs text-app-muted">
              Page {data?.page ?? 1} of {Math.max(1, data?.totalPages ?? 1)}
            </span>
            <div className="flex gap-2">
              <Button
                kind="secondary"
                disabled={page <= 1 || loading}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <Button
                kind="secondary"
                disabled={page >= (data?.totalPages ?? 1) || loading}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
