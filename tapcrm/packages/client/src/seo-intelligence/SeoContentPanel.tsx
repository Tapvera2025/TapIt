import { useEffect, useRef, useState } from 'react';
import {
  EMPTY_CONTENT_SNAPSHOT,
  type ContentDocument,
  type ContentSnapshot,
  type ContentBrand,
  contentBodyToPlainText,
} from '@tapcrm/contracts';
import { Button } from '../ui/index.js';
import { Icon } from '../ui/index.js';
import { SeoEmptyState, SeoSectionHeader, SeoBadge } from './SeoUi.js';
import { useSeoResource } from './useSeoResource.js';
import * as api from './content-api.js';
import { CollaborativeDraftEditor } from './CollaborativeDraftEditor.js';
import './seo-content.css';

export interface ContentAccess {
  userId: string;
  userName: string;
  administrator: boolean;
  read: boolean;
  create: boolean;
  edit: boolean;
  review: boolean;
  comment: boolean;
  export: boolean;
  brand: boolean;
}
const statusLabel = {
  draft: 'Draft',
  in_review: 'Ready for review',
  approved: 'Approved',
  archived: 'Archived',
};
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : 'This request could not be completed. Please try again.';
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SeoContentPanel({
  siteId,
  access,
  onDirtyChange,
  initialView = 'board',
  seed,
  onSeedConsumed,
}: {
  siteId: string;
  access: ContentAccess;
  onDirtyChange: (dirty: boolean) => void;
  initialView?: 'board' | 'brand';
  seed?: { query: string } | null;
  onSeedConsumed: () => void;
}) {
  const [selected, setSelected] = useState<ContentDocument | null>(null);
  const view = initialView;
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useSeoResource(access?.read ? `${siteId}:content:${offset}` : null, () =>
    api.listContent(siteId, offset),
  );
  const brand = useSeoResource(access?.read ? `${siteId}:brand` : null, () =>
    api.readBrand(siteId),
  );
  const members = useSeoResource(access?.read ? `${siteId}:content-members` : null, () =>
    api.contentMembers(siteId),
  );
  useEffect(() => {
    if (seed && access.create) {
      setCreating(true);
      setTitle(seed.query);
    }
  }, [seed, access.create]);
  if (!access?.read)
    return (
      <SeoEmptyState
        title="Content access is managed separately"
        description="Ask your administrator for content permissions. Writers see assigned drafts; reviewers see documents assigned to them."
      />
    );
  if (selected)
    return (
      <ContentEditor
        key={selected.id}
        initial={selected}
        access={access}
        members={members.data ?? []}
        membersError={members.error}
        brand={brand.data}
        onDirtyChange={onDirtyChange}
        onBack={() => {
          setSelected(null);
          list.reload();
        }}
      />
    );
  async function create() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      setSelected(
        await api.createContent(
          siteId,
          {
            ...EMPTY_CONTENT_SNAPSHOT,
            title: title.trim(),
            keywords: seed?.query ?? '',
            purpose: seed
              ? `Create a useful page for people searching for “${seed.query}”.`
              : '',
            brandVersion: brand.data?.version || null,
          },
          null,
        ),
      );
      setCreating(false);
      setTitle('');
      if (seed) onSeedConsumed();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    setBusy(true);
    setError('');
    try {
      setSelected(await api.readContent(siteId, id));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="content-workspace">
      <SeoSectionHeader
        eyebrow="CONTENT STUDIO"
        title="Turn ideas into useful content"
        description="Plan your message, write with context, and give every article a clear next step."
        action={
          access.create && view === 'board' ? (
            <Button onClick={() => setCreating(true)}>
              <Icon name="plus" className="size-4" /> New article
            </Button>
          ) : undefined
        }
      />
      {error && (
        <p role="alert" className="content-error">
          {error}
        </p>
      )}
      {view === 'brand' ? (
        brand.error ? (
          <ContentFailure error={brand.error} retry={brand.reload} />
        ) : brand.data ? (
          <BrandEditor
            key={brand.data.version}
            siteId={siteId}
            initial={brand.data}
            canEdit={access.brand}
            onSaved={brand.reload}
            onDirtyChange={onDirtyChange}
          />
        ) : (
          <p role="status">Loading brand guidance…</p>
        )
      ) : (
        <>
          {creating && (
            <form
              className="content-create"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <label>
                What are you writing about?
                <input
                  autoFocus
                  required
                  maxLength={200}
                  placeholder="e.g. A practical guide to choosing a CRM"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <div className="content-actions">
                <Button type="submit" disabled={busy || !title.trim()}>
                  Create draft
                </Button>
                <Button
                  kind="secondary"
                  onClick={() => {
                    setCreating(false);
                    setTitle('');
                    if (seed) onSeedConsumed();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
          <div className="content-journey" aria-label="Content workflow">
            {[
              'Plan the brief',
              'Write the draft',
              'Review together',
              'Export when ready',
            ].map((s, i) => (
              <div key={s}>
                <span>{i + 1}</span>
                {s}
              </div>
            ))}
          </div>
          {list.error ? (
            <ContentFailure error={list.error} retry={list.reload} />
          ) : !list.data ? (
            <p role="status">Loading your articles…</p>
          ) : list.data.items.length === 0 ? (
            <SeoEmptyState
              title="Your next good article starts here"
              description="Create a brief for this website. Add the audience, search terms and sources, then write a draft and send it to a reviewer."
            />
          ) : (
            <>
              <p className="seo-small-copy">
                {list.data.total} accessible article{list.data.total === 1 ? '' : 's'} ·
                Showing {offset + 1}–{Math.min(offset + 25, list.data.total)}
              </p>
              <div className="content-board">
                {list.data.items.map((item) => (
                  <button
                    disabled={busy}
                    className="content-article"
                    key={item.id}
                    onClick={() => void open(item.id)}
                  >
                    <div className="content-article-top">
                      <span className="content-page-icon">
                        <Icon name="file-text" className="size-5" />
                      </span>
                      <SeoBadge tone={item.status === 'approved' ? 'accent' : 'neutral'}>
                        {statusLabel[item.status]}
                      </SeoBadge>
                    </div>
                    <h3>{item.snapshot.title}</h3>
                    <p>
                      {item.snapshot.purpose ||
                        'Add a purpose and audience to shape this article.'}
                    </p>
                    <footer>
                      <span>{item.ownerName}</span>
                      <span>
                        {item.snapshot.dueDate
                          ? `Due ${item.snapshot.dueDate}`
                          : `Version ${item.version}`}
                      </span>
                    </footer>
                    <small>Updated {date(item.updatedAt)}</small>
                  </button>
                ))}
              </div>
              <div className="content-actions">
                <Button
                  kind="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 25))}
                >
                  Previous
                </Button>
                <Button
                  kind="secondary"
                  disabled={offset + 25 >= list.data.total}
                  onClick={() => setOffset(offset + 25)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
          <p className="seo-small-copy">
            Drafting and export do not publish to your website or resolve a website issue.
            AI writing and simultaneous editing arrive in later phases.
          </p>
        </>
      )}
    </div>
  );
}
function ContentFailure({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div role="alert" className="content-error">
      {error}{' '}
      <Button kind="secondary" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

function BrandEditor({
  siteId,
  initial,
  canEdit,
  onSaved,
  onDirtyChange,
}: {
  siteId: string;
  initial: ContentBrand;
  canEdit: boolean;
  onSaved: () => void;
  onDirtyChange: (d: boolean) => void;
}) {
  const [guidance, setGuidance] = useState(initial.guidance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = guidance !== initial.guidance;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.saveBrand(siteId, initial.version, guidance);
      onDirtyChange(false);
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-brand">
      <div>
        <h3>A consistent voice, every time</h3>
        <p>
          Write down your audience, tone, approved facts, terminology, calls to action and
          claims to avoid.
        </p>
        <p className="seo-small-copy">
          {initial.scope === 'client'
            ? 'Shared by websites linked to this CRM client.'
            : 'Applies to this standalone website.'}{' '}
          {initial.version
            ? `Saved version ${initial.version}.`
            : 'No guidance saved yet.'}{' '}
          Articles retain the guidance version selected in their brief.
        </p>
      </div>
      <label>
        Brand guidance
        <textarea
          rows={14}
          maxLength={20000}
          value={guidance}
          disabled={!canEdit || busy}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder="Audience: …\nVoice and tone: …\nApproved facts and sources: …\nWords and claims to avoid: …\nPreferred call to action: …"
        />
      </label>
      {error && (
        <p role="alert" className="content-error">
          {error}
        </p>
      )}
      {canEdit ? (
        <Button disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save guidance version'}
        </Button>
      ) : (
        <p className="seo-small-copy">
          You can read this guidance. Editing requires brand-management permission.
        </p>
      )}
    </section>
  );
}

function ContentEditor({
  initial,
  access,
  members,
  membersError,
  brand,
  onBack,
  onDirtyChange,
}: {
  initial: ContentDocument;
  access: ContentAccess;
  members: { id: string; name: string }[];
  membersError: string | null;
  brand: ContentBrand | undefined;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [doc, setDoc] = useState(initial);
  const [draft, setDraft] = useState(initial.snapshot);
  const [versionSnapshot, setVersionSnapshot] = useState(initial.snapshot);
  const [reviewer, setReviewer] = useState(initial.reviewerId);
  const [tab, setTab] = useState<'brief' | 'checks' | 'history'>('brief');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [note, setNote] = useState('');
  const [historyOffset, setHistoryOffset] = useState(0);
  const current = useRef({ doc, draft, reviewer });
  current.current = { doc, draft, reviewer };
  const pending = useRef(false);
  const editable =
    access.edit &&
    (access.administrator || doc.ownerId === access.userId) &&
    doc.status !== 'archived';
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(doc.snapshot) || reviewer !== doc.reviewerId;
  const hasUnversionedChanges =
    JSON.stringify(doc.snapshot) !== JSON.stringify(versionSnapshot);
  const [recovery, setRecovery] = useState<{
    snapshot: ContentSnapshot;
    reviewerId: string | null;
    version: number;
  } | null>(null);
  const recoveryKey = `tapcrm.content-draft:${access.userId}:${doc.siteId}:${doc.id}`;
  const history = useSeoResource(
    tab === 'history' ? `${doc.id}:history:${doc.version}:${historyOffset}` : null,
    () => api.contentHistory(doc.siteId, doc.id, historyOffset),
  );
  const comments = useSeoResource(`${doc.id}:comments`, () =>
    api.contentCommentThreads(doc.siteId, doc.id),
  );
  const pinnedBrand = useSeoResource(
    draft.brandVersion ? `${doc.siteId}:brand:${draft.brandVersion}` : null,
    () => api.readBrand(doc.siteId, draft.brandVersion ?? undefined),
  );
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(recoveryKey);
      if (raw) {
        const value = JSON.parse(raw) as {
          snapshot: ContentSnapshot;
          reviewerId: string | null;
          version: number;
        };
        if (value.snapshot && typeof value.snapshot.body === 'string' && value.version)
          setRecovery(value);
      }
    } catch {
      /* Recovery is best effort; server saves remain authoritative. */
    }
  }, [recoveryKey]);
  useEffect(() => {
    onDirtyChange(dirty);
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    if (dirty)
      try {
        sessionStorage.setItem(
          recoveryKey,
          JSON.stringify({ snapshot: draft, reviewerId: reviewer, version: doc.version }),
        );
      } catch {
        /* Visible save status still reports unsaved changes. */
      }
    return () => {
      window.removeEventListener('beforeunload', unload);
      onDirtyChange(false);
    };
  }, [dirty, draft, reviewer, doc.version, recoveryKey, onDirtyChange]);
  async function save() {
    if (pending.current || !editable) return;
    const captured = current.current;
    if (!captured.draft.title.trim()) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const nonBodyChanges =
        Object.keys(captured.draft).some(
          (key) =>
            key !== 'body' &&
            captured.draft[key as keyof ContentSnapshot] !==
              captured.doc.snapshot[key as keyof ContentSnapshot],
        ) || captured.reviewer !== captured.doc.reviewerId;
      const saved = nonBodyChanges
        ? await api.saveContent(
            doc.siteId,
            doc.id,
            captured.doc.version,
            captured.draft,
            captured.reviewer,
          )
        : await api.saveContentBody(doc.siteId, doc.id, captured.draft.body);
      setDoc(saved);
      if (saved.version !== captured.doc.version) setVersionSnapshot(saved.snapshot);
      if (
        JSON.stringify(current.current.draft) === JSON.stringify(captured.draft) &&
        current.current.reviewer === captured.reviewer
      ) {
        sessionStorage.removeItem(recoveryKey);
        setNotice('All changes saved.');
      } else {
        try {
          sessionStorage.setItem(
            recoveryKey,
            JSON.stringify({
              snapshot: current.current.draft,
              reviewerId: current.current.reviewer,
              version: saved.version,
            }),
          );
        } catch {
          /* Recovery remains best effort. */
        }
      }
    } catch (e) {
      setError(message(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!dirty || busy || error || recovery || !editable || !draft.title.trim()) return;
    const timer = setTimeout(() => void save(), 1400);
    return () => clearTimeout(timer);
  });
  async function action(run: () => Promise<ContentDocument>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await run();
      setDoc(next);
      setDraft(next.snapshot);
      setVersionSnapshot(next.snapshot);
      setReviewer(next.reviewerId);
      setNote('');
      sessionStorage.removeItem(recoveryKey);
      setNotice('Saved.');
    } catch (e) {
      setError(message(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function createRevision() {
    if (pending.current || !editable || dirty || !hasUnversionedChanges) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await api.checkpointContent(doc.siteId, doc.id, doc.version);
      setDoc(next);
      setDraft(next.snapshot);
      setVersionSnapshot(next.snapshot);
      setNotice(`Revision ${next.version} saved.`);
    } catch (e) {
      setError(message(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function transition(value: string) {
    void action(() =>
      api.transitionContent(doc.siteId, doc.id, doc.version, value, note),
    );
  }
  function patch(key: keyof ContentSnapshot, value: string | number | null) {
    setDraft((old) => ({ ...old, [key]: value }));
    setNotice('');
  }
  const plainBody = contentBodyToPlainText(draft.body);
  const words = plainBody.trim() ? plainBody.trim().split(/\s+/).length : 0;
  const reviewable =
    access.review &&
    doc.ownerId !== access.userId &&
    (access.administrator || doc.reviewerId === access.userId) &&
    doc.status === 'in_review';
  const locked = busy || dirty || !!error || !!recovery;
  return (
    <div className="content-workspace">
      <div className="content-editor-header">
        <Button
          kind="secondary"
          onClick={() => {
            if (
              !dirty ||
              window.confirm(
                'Your latest text has not been saved to the server. Leave this article?',
              )
            )
              onBack();
          }}
        >
          ← All articles
        </Button>
        <div className="content-save-state" role="status">
          {busy
            ? 'Saving…'
            : error
              ? 'Changes need attention'
              : dirty
                ? 'Unsaved changes'
                : `Saved · version ${doc.version}`}
        </div>
        <SeoBadge tone={doc.status === 'approved' ? 'accent' : 'neutral'}>
          {statusLabel[doc.status]}
        </SeoBadge>
      </div>
      {recovery && (
        <div className="content-warning">
          <strong>Unsaved text was found in this browser tab.</strong>
          <p>
            {recovery.version === doc.version
              ? 'You can recover it before continuing.'
              : 'The server has changed since this text was written. Download it and compare before making changes.'}
          </p>
          <div className="content-actions">
            {editable && recovery.version === doc.version && (
              <Button
                onClick={() => {
                  setDraft(recovery.snapshot);
                  setReviewer(recovery.reviewerId);
                  setRecovery(null);
                }}
              >
                Recover my text
              </Button>
            )}
            <Button
              kind="secondary"
              onClick={() =>
                download(
                  `${recovery.snapshot.title}\n\n${contentBodyToPlainText(recovery.snapshot.body)}`,
                  'recovered-draft.txt',
                )
              }
            >
              Download recovery copy
            </Button>
            <Button
              kind="secondary"
              onClick={() => {
                sessionStorage.removeItem(recoveryKey);
                setRecovery(null);
              }}
            >
              Use saved version
            </Button>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="content-error">
          <p>{error}</p>
          <div className="content-actions">
            <Button
              kind="secondary"
              onClick={() =>
                download(
                  `${draft.title}\n\n${contentBodyToPlainText(draft.body)}`,
                  'unsaved-draft.txt',
                )
              }
            >
              Download my text
            </Button>
            <Button
              kind="secondary"
              onClick={() => {
                if (
                  window.confirm(
                    'Replace the editor with the latest server version? Download your text first to keep a copy.',
                  )
                )
                  void action(() => api.readContent(doc.siteId, doc.id));
              }}
            >
              Reload saved version
            </Button>
            {editable && (
              <Button kind="secondary" disabled={busy} onClick={() => void save()}>
                Retry save
              </Button>
            )}
          </div>
        </div>
      )}
      {notice && !dirty && (
        <p className="seo-small-copy" role="status">
          {notice}
        </p>
      )}
      <div className="content-editor-grid">
        <section className="content-writing">
          <label className="content-title-label">
            Article title
            <input
              aria-label="Article title"
              maxLength={200}
              value={draft.title}
              disabled={!editable}
              onChange={(e) => patch('title', e.target.value)}
              placeholder="Give your article a clear title"
            />
          </label>
          <div className="content-writing-meta">
            <span>{words.toLocaleString()} words</span>
            <span>Writer: {doc.ownerName}</span>
          </div>
          <div className="content-body-label">
            <span>Your draft</span>
            <CollaborativeDraftEditor
              documentId={doc.id}
              userId={access.userId}
              userName={access.userName}
              body={draft.body}
              revision={doc.version}
              editable={editable}
              canComment={access.comment}
              threads={comments.data ?? []}
              threadError={comments.error}
              onCreateThread={async (input) => {
                const thread = await api.createContentComment(doc.siteId, doc.id, input);
                comments.reload();
                return thread;
              }}
              onUpdateThread={async (threadId, status) => {
                await api.updateContentComment(doc.siteId, doc.id, threadId, status);
                comments.reload();
              }}
              onCommitBody={async (body) => {
                patch('body', body);
                setDoc(await api.saveContentBody(doc.siteId, doc.id, body));
              }}
              onBodyChange={(body) => patch('body', body)}
            />
          </div>
          <p className="seo-small-copy">
            Rich-text drafting · Live shared editing · Changes sync automatically. Save a
            numbered revision when you are ready to keep a checkpoint.
          </p>
          {editable && dirty && (
            <Button
              disabled={!dirty || busy || !draft.title.trim() || !!recovery}
              onClick={() => void save()}
            >
              Save now
            </Button>
          )}
          {editable && hasUnversionedChanges && (
            <Button
              kind="secondary"
              disabled={dirty || busy || !!error || !!recovery}
              onClick={() => void createRevision()}
            >
              {busy ? 'Saving…' : 'Save revision'}
            </Button>
          )}
        </section>
        <aside className="content-inspector">
          <div className="content-inspector-tabs">
            {(['brief', 'checks', 'history'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t === 'brief' ? 'The brief' : t === 'checks' ? 'Readiness' : 'History'}
              </button>
            ))}
          </div>
          {tab === 'brief' ? (
            <div className="content-fields">
              {(
                [
                  ['audience', 'Who is this for?', 'Describe your reader'],
                  [
                    'purpose',
                    'What should they learn or do?',
                    'The useful outcome of this article',
                  ],
                  ['keywords', 'Search terms', 'Primary and related search terms'],
                  [
                    'outline',
                    'Outline and required sections',
                    'The questions this article should answer',
                  ],
                  [
                    'sources',
                    'Sources and approved facts',
                    'URLs, notes and facts to verify',
                  ],
                  ['targetUrl', 'Planned website URL', 'https://example.com/article'],
                  [
                    'metaDescription',
                    'Search description',
                    'A useful summary for search results',
                  ],
                ] as const
              ).map(([key, label, placeholder]) => (
                <label key={key}>
                  {label}
                  {['outline', 'sources', 'purpose', 'metaDescription'].includes(key) ? (
                    <textarea
                      rows={3}
                      maxLength={key === 'outline' || key === 'sources' ? 10000 : 2000}
                      value={draft[key]}
                      disabled={!editable}
                      placeholder={placeholder}
                      onChange={(e) => patch(key, e.target.value)}
                    />
                  ) : (
                    <input
                      maxLength={2000}
                      value={draft[key]}
                      disabled={!editable}
                      placeholder={placeholder}
                      onChange={(e) => patch(key, e.target.value)}
                    />
                  )}
                </label>
              ))}
              <label>
                Due date
                <input
                  type="date"
                  value={draft.dueDate}
                  disabled={!editable}
                  onChange={(e) => patch('dueDate', e.target.value)}
                />
              </label>
              <label>
                Reviewer
                <select
                  value={reviewer ?? ''}
                  disabled={!editable || !!membersError}
                  onChange={(e) => setReviewer(e.target.value || null)}
                >
                  <option value="">Choose a reviewer</option>
                  {members
                    .filter((m) => m.id !== doc.ownerId)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              {membersError && (
                <p role="alert" className="content-error">
                  Reviewer choices unavailable: {membersError}
                </p>
              )}
              <div className="content-brand-note">
                <strong>
                  Brand guidance {draft.brandVersion ? `· v${draft.brandVersion}` : ''}
                </strong>
                {pinnedBrand.error ? (
                  <p role="alert">{pinnedBrand.error}</p>
                ) : (
                  <p>
                    {pinnedBrand.data?.guidance ||
                      (draft.brandVersion
                        ? 'Loading guidance…'
                        : 'No brand guidance selected for this draft.')}
                  </p>
                )}
                {editable &&
                  brand &&
                  brand.version > 0 &&
                  draft.brandVersion !== brand.version && (
                    <Button
                      kind="secondary"
                      onClick={() => patch('brandVersion', brand.version)}
                    >
                      Use latest guidance (v{brand.version})
                    </Button>
                  )}
              </div>
            </div>
          ) : tab === 'checks' ? (
            <div className="content-fields">
              <h3>Ready for a human review?</h3>
              <p className="seo-small-copy">
                These are brief-completeness checks, not a ranking or factual-accuracy
                score.
              </p>
              {[
                ['Title', !!draft.title.trim()],
                ['Audience', !!draft.audience.trim()],
                ['Purpose', !!draft.purpose.trim()],
                ['Draft text', words > 0],
                ['Assigned reviewer', !!reviewer],
                ['Source notes', !!draft.sources.trim()],
              ].map(([label, ok]) => (
                <div className="content-check" key={String(label)}>
                  <span>
                    {ok ? '✓' : '○'} {label}
                  </span>
                  <small>{ok ? 'Added' : 'To add'}</small>
                </div>
              ))}
              <p className="seo-small-copy">
                Sources still need human verification. Exporting does not check
                indexability, page speed, or whether the website has changed.
              </p>
            </div>
          ) : (
            <div className="content-fields">
              {history.error ? (
                <ContentFailure error={history.error} retry={history.reload} />
              ) : !history.data ? (
                <p role="status">Loading history…</p>
              ) : (
                <>
                  <h3>Saved revisions</h3>
                  {history.data.versions.map((v) => (
                    <details className="content-history" key={v.version}>
                      <summary>
                        Version {v.version} · {v.reason.replaceAll('_', ' ')}
                        <small>
                          {v.authorName} · {date(v.createdAt)}
                        </small>
                      </summary>
                      <pre>
                        {contentBodyToPlainText(v.snapshot.body) ||
                          'Brief only — no draft text yet.'}
                      </pre>
                      {editable && v.version !== doc.version && (
                        <Button
                          kind="secondary"
                          disabled={locked}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Restore version ${v.version} as a new draft revision? Existing history will be kept.`,
                              )
                            )
                              void action(() =>
                                api.restoreContent(
                                  doc.siteId,
                                  doc.id,
                                  doc.version,
                                  v.version,
                                ),
                              );
                          }}
                        >
                          Restore as new revision
                        </Button>
                      )}
                    </details>
                  ))}
                  <div className="content-actions">
                    <Button
                      kind="secondary"
                      disabled={historyOffset === 0}
                      onClick={() => setHistoryOffset(Math.max(0, historyOffset - 20))}
                    >
                      Newer
                    </Button>
                    <Button
                      kind="secondary"
                      disabled={history.data.versions.length < 20}
                      onClick={() => setHistoryOffset(historyOffset + 20)}
                    >
                      Older
                    </Button>
                  </div>
                  <h3>Recent activity</h3>
                  {history.data.events.map((e) => (
                    <p key={e.id} className="content-event">
                      <strong>
                        {e.action.replaceAll('_', ' ')} · v{e.version}
                      </strong>
                      <small>
                        {e.actorName} · {date(e.createdAt)}
                      </small>
                      {e.note && <span>{e.note}</span>}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}
        </aside>
      </div>
      <section className="content-review">
        <div>
          <h3>
            {reviewable ? 'Review this saved version' : 'Move your article forward'}
          </h3>
          <p>
            {doc.status === 'approved'
              ? `Version ${doc.approvedVersion} is approved. Editing creates a new draft requiring review.`
              : doc.status === 'in_review'
                ? 'Waiting for an authorized reviewer. Editing will return this article to draft.'
                : 'Save your brief and draft, then ask a reviewer to check them.'}
          </p>
        </div>
        {reviewable && (
          <label>
            Review note
            <textarea
              maxLength={2000}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain any changes needed"
            />
          </label>
        )}
        <div className="content-actions">
          {editable && doc.status === 'draft' && (
            <Button disabled={locked} onClick={() => transition('submit')}>
              Send for review
            </Button>
          )}
          {reviewable && (
            <>
              <Button disabled={locked} onClick={() => transition('approve')}>
                Approve version {doc.version}
              </Button>
              <Button
                kind="secondary"
                disabled={locked || !note.trim()}
                onClick={() => transition('request_changes')}
              >
                Request changes
              </Button>
            </>
          )}
          {access.export && (
            <Button
              kind="secondary"
              disabled={locked}
              onClick={() => {
                void (async () => {
                setBusy(true);
                try {
                  const result = await api.exportContent(doc.siteId, doc.id);
                  download(result.text, result.filename);
                  history.reload();
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
                })();
              }}
            >
              Export saved text
            </Button>
          )}
          {access.edit && (access.administrator || doc.ownerId === access.userId) && (
            <Button
              kind="secondary"
              disabled={locked}
              onClick={() => {
                const value = doc.status === 'archived' ? 'reopen' : 'archive';
                if (
                  value === 'reopen' ||
                  window.confirm(
                    'Archive this article? Its saved revisions will be kept.',
                  )
                )
                  transition(value);
              }}
            >
              {doc.status === 'archived' ? 'Reopen draft' : 'Archive'}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
