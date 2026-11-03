import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from '@tiptap/y-tiptap';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { plainTextToContentJson } from '@tapcrm/contracts';
import type { ContentCommentThread } from '@tapcrm/contracts';
import type { CreateContentCommentInput } from './content-api.js';
import { getIdentityAccessToken } from '../identity/api/authApi.js';

interface SharedSession {
  document: Y.Doc;
  provider: HocuspocusProvider;
}
interface Collaborator {
  id: string;
  name: string;
  color: string;
}

function endpoint() {
  const configured = import.meta.env['VITE_CONTENT_COLLAB_URL'];
  if (configured) return configured;
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.hostname}:4001`;
}

function colorFor(id: string) {
  return `#${id.replace(/-/g, '').slice(0, 6).padEnd(6, '7')}`;
}

function encodeRelative(position: Y.RelativePosition) {
  const bytes = Y.encodeRelativePosition(position);
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeRelative(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Y.decodeRelativePosition(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function resolvedAnchorInState(
  state: EditorState,
  document: Y.Doc,
  thread: Pick<ContentCommentThread, 'anchorFrom' | 'anchorTo'>,
) {
  const sync = ySyncPluginKey.getState(state);
  if (!sync) return null;
  try {
    const from = relativePositionToAbsolutePosition(
      document,
      sync.type,
      decodeRelative(thread.anchorFrom),
      sync.binding.mapping,
    );
    const to = relativePositionToAbsolutePosition(
      document,
      sync.type,
      decodeRelative(thread.anchorTo),
      sync.binding.mapping,
    );
    return from !== null && to !== null && to > from ? { from, to } : null;
  } catch {
    return null;
  }
}

export function CollaborativeDraftEditor({
  documentId,
  userId,
  userName,
  body,
  revision,
  editable,
  canComment,
  threads,
  threadError,
  onCreateThread,
  onUpdateThread,
  onCommitBody,
  onBodyChange,
}: {
  documentId: string;
  userId: string;
  userName: string;
  body: string;
  revision: number;
  editable: boolean;
  canComment: boolean;
  threads: ContentCommentThread[];
  threadError: string | null;
  onCreateThread: (input: CreateContentCommentInput) => Promise<ContentCommentThread>;
  onUpdateThread: (
    threadId: string,
    status: ContentCommentThread['status'],
  ) => Promise<void>;
  onCommitBody: (body: string) => Promise<void>;
  onBodyChange: (body: string) => void;
}) {
  const [session, setSession] = useState<SharedSession | null>(null);
  const [status, setStatus] = useState('connecting');
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState('');
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<{
    kind: 'comment' | 'suggestion';
    anchorFrom: string;
    anchorTo: string;
    quotedText: string;
  } | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [suggestedText, setSuggestedText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState('');
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const fallbackDocument = useMemo(() => new Y.Doc(), []);
  const onBodyChangeRef = useRef(onBodyChange);
  const currentRevision = useRef<number | null>(null);
  onBodyChangeRef.current = onBodyChange;

  useEffect(() => {
    let active = true;
    const document = new Y.Doc();
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: endpoint(),
      delay: 1000,
      maxAttempts: 0,
    });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: documentId,
      document,
      token: async () => getIdentityAccessToken() ?? '',
    });
    const nextSession = { document, provider };
    const onStatus = (event: { status: string }) => {
      if (active) setStatus(event.status);
    };
    const onSynced = (event: { state: boolean }) => {
      if (active) setSynced(event.state);
    };
    const onAuthenticationFailed = () => {
      if (active)
        setError('Your sign-in has expired. Sign in again to continue editing.');
    };
    const awareness = provider.awareness;
    const onAwarenessChange = () => {
      if (!active || !awareness) return;
      const entries = [...awareness.getStates().values()].flatMap((value) => {
        const user = value['user'] as Partial<Collaborator> | undefined;
        return user?.id && user.name
          ? [{ id: user.id, name: user.name, color: user.color || '#4565a8' }]
          : [];
      });
      const unique = [...new Map(entries.map((item) => [item.id, item])).values()];
      setCollaborators(unique);
    };
    provider.on('status', onStatus);
    provider.on('synced', onSynced);
    provider.on('authenticationFailed', onAuthenticationFailed);
    awareness?.on('change', onAwarenessChange);
    setSession(nextSession);
    return () => {
      active = false;
      awareness?.off('change', onAwarenessChange);
      provider.off('status', onStatus);
      provider.off('synced', onSynced);
      provider.off('authenticationFailed', onAuthenticationFailed);
      provider.destroy();
      document.destroy();
      setSession((current) => (current === nextSession ? null : current));
    };
  }, [documentId]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({
          document: session?.document ?? fallbackDocument,
        }),
        ...(session
          ? [
              CollaborationCaret.configure({
                provider: session.provider,
                user: {
                  id: userId,
                  name: userName || 'TapCRM user',
                  color: colorFor(userId),
                },
              }),
            ]
          : []),
      ],
      editable: Boolean(
        session && synced && status === 'connected' && editable && !error,
      ),
      editorProps: {
        attributes: {
          'aria-label': 'Article draft',
          spellcheck: 'true',
        },
        decorations: (state) => {
          const sync = ySyncPluginKey.getState(state);
          if (!sync) return DecorationSet.empty;
          const marks = threadsRef.current.flatMap((thread) => {
            const anchor = resolvedAnchorInState(
              state,
              session?.document ?? fallbackDocument,
              thread,
            );
            if (!anchor) return [];
            const actual = state.doc.textBetween(anchor.from, anchor.to, '\n').trim();
            if (!actual || actual !== thread.quotedText.trim()) return [];
            return [
              Decoration.inline(anchor.from, anchor.to, {
                class: `content-thread-mark is-${thread.status}`,
                'data-thread-id': thread.id,
                'data-thread-kind': thread.kind,
                'data-thread-status': thread.status,
              }),
            ];
          });
          return DecorationSet.create(state.doc, marks);
        },
        handleDOMEvents: {
          click: (_view, event) => {
            const target =
              event.target instanceof Element
                ? event.target.closest<HTMLElement>('[data-thread-id]')
                : null;
            if (target?.dataset['threadId']) {
              setActiveThread(target.dataset['threadId']);
              return true;
            }
            return false;
          },
        },
      },
      onUpdate: ({ editor: current }) => {
        onBodyChangeRef.current(JSON.stringify(current.getJSON()));
      },
    },
    [session?.document, session?.provider],
  );

  useEffect(() => () => fallbackDocument.destroy(), [fallbackDocument]);

  useEffect(() => {
    if (editor)
      editor.setEditable(synced && status === 'connected' && editable && !error);
  }, [editor, synced, status, editable, error]);

  useEffect(() => {
    if (!editor || !synced) return;
    if (currentRevision.current === null) {
      currentRevision.current = revision;
      return;
    }
    if (currentRevision.current === revision) return;
    currentRevision.current = revision;
    const restored = plainTextToContentJson(body);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(restored)) {
      // Restore is represented as fresh CRDT operations so every connected editor sees it.
      editor.commands.setContent(restored, { emitUpdate: true });
    }
  }, [editor, synced, revision, body]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta('content-threads-refresh', true));
  }, [editor, threads]);

  function startComment(kind: 'comment' | 'suggestion') {
    if (!editor || !session) return;
    const selection = editor.state.selection;
    const quotedText = editor.state.doc
      .textBetween(selection.from, selection.to, '\n')
      .trim();
    const sync = ySyncPluginKey.getState(editor.state);
    if (!sync || !quotedText) return;
    setCommentDraft({
      kind,
      anchorFrom: encodeRelative(
        absolutePositionToRelativePosition(
          selection.from,
          sync.type,
          sync.binding.mapping,
        ),
      ),
      anchorTo: encodeRelative(
        absolutePositionToRelativePosition(selection.to, sync.type, sync.binding.mapping),
      ),
      quotedText,
    });
    setCommentBody('');
    setSuggestedText('');
    setCommentError('');
  }

  async function submitComment() {
    if (!commentDraft || !commentBody.trim() || commentBusy) return;
    if (commentDraft.kind === 'suggestion' && !suggestedText.trim()) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const thread = await onCreateThread({
        ...commentDraft,
        body: commentBody.trim(),
        suggestedText: commentDraft.kind === 'suggestion' ? suggestedText : null,
      });
      setActiveThread(thread.id);
      setCommentDraft(null);
    } catch (error) {
      setCommentError(
        error instanceof Error ? error.message : 'Could not save this review note.',
      );
    } finally {
      setCommentBusy(false);
    }
  }

  async function acceptSuggestion(thread: ContentCommentThread) {
    if (!editor || !session || !thread.suggestedText) return;
    const anchor = resolvedAnchorInState(editor.state, session.document, thread);
    if (!anchor) {
      setCommentError('This suggestion no longer points to text in the draft.');
      return;
    }
    const actual = editor.state.doc.textBetween(anchor.from, anchor.to, '\n').trim();
    if (actual !== thread.quotedText.trim()) {
      setCommentError(
        'The selected text has changed. Review it before applying this suggestion.',
      );
      return;
    }
    setCommentBusy(true);
    setCommentError('');
    try {
      editor
        .chain()
        .focus()
        .setTextSelection(anchor)
        .insertContent(thread.suggestedText)
        .run();
      await onCommitBody(JSON.stringify(editor.getJSON()));
      await onUpdateThread(thread.id, 'accepted');
    } catch (error) {
      setCommentError(
        error instanceof Error ? error.message : 'Could not apply this suggestion.',
      );
    } finally {
      setCommentBusy(false);
    }
  }

  async function updateThreadStatus(
    thread: ContentCommentThread,
    status: ContentCommentThread['status'],
  ) {
    if (commentBusy) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      await onUpdateThread(thread.id, status);
    } catch (error) {
      setCommentError(
        error instanceof Error ? error.message : 'Could not update this review note.',
      );
    } finally {
      setCommentBusy(false);
    }
  }

  function focusThread(thread: ContentCommentThread) {
    if (!editor || !session) return;
    const anchor = resolvedAnchorInState(editor.state, session.document, thread);
    setActiveThread(thread.id);
    if (anchor) editor.chain().focus().setTextSelection(anchor).run();
  }

  if (!session || !editor) {
    return (
      <div className="collab-connection" role="status">
        Connecting to the shared draft…
      </div>
    );
  }

  const ready = status === 'connected' && synced && !error;
  return (
    <div className="collab-editor">
      <div className="collab-toolbar" role="toolbar" aria-label="Text formatting">
        <button
          type="button"
          disabled={!ready || !editable}
          aria-label="Bold"
          aria-pressed={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          disabled={!ready || !editable}
          aria-label="Italic"
          aria-pressed={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <span aria-hidden="true" />
        <button
          type="button"
          disabled={!ready || !editable}
          aria-label="Heading"
          aria-pressed={editor.isActive('heading')}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </button>
        <button
          type="button"
          disabled={!ready || !editable}
          aria-label="Bulleted list"
          aria-pressed={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • List
        </button>
        <button
          type="button"
          disabled={!ready || !editable}
          aria-label="Numbered list"
          aria-pressed={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </button>
        <button
          type="button"
          disabled={!ready || !editable}
          aria-label="Add link"
          onClick={() => {
            const href = window.prompt('Link address (https://…)');
            if (href && /^https?:\/\//i.test(href))
              editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
          }}
        >
          Link
        </button>
        {canComment && (
          <button
            type="button"
            disabled={!ready}
            aria-label="Comment on selected text"
            onClick={() => startComment('comment')}
          >
            Comment
          </button>
        )}
        {canComment && (
          <button
            type="button"
            disabled={!ready}
            aria-label="Suggest a replacement for selected text"
            onClick={() => startComment('suggestion')}
          >
            Suggest edit
          </button>
        )}
      </div>
      <div className="collab-live-row">
        <span
          className={`collab-status-dot ${ready ? 'is-connected' : ''}`}
          aria-hidden="true"
        />
        <span role="status">
          {error ||
            (ready
              ? 'Live and saved to the shared draft'
              : status === 'disconnected'
                ? 'Reconnecting… editing is paused'
                : 'Syncing the latest draft…')}
        </span>
        {collaborators.length > 0 && (
          <div className="collab-people" aria-label="People in this document">
            {collaborators.map((person) => (
              <span
                key={person.id}
                style={{ '--collab-color': person.color } as React.CSSProperties}
                title={person.name}
              >
                {person.name.trim().slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </div>
      <EditorContent editor={editor} className="collab-document" />
      {commentDraft && (
        <form
          className="content-thread-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitComment();
          }}
        >
          <div className="content-thread-quote">
            <strong>
              {commentDraft.kind === 'comment' ? 'Comment on' : 'Suggest a change to'}
            </strong>
            <span>“{commentDraft.quotedText}”</span>
          </div>
          {commentDraft.kind === 'suggestion' && (
            <label>
              Replacement text
              <textarea
                rows={3}
                maxLength={500000}
                value={suggestedText}
                onChange={(event) => setSuggestedText(event.target.value)}
                autoFocus
              />
            </label>
          )}
          <label>
            {commentDraft.kind === 'comment' ? 'Your comment' : 'Why this change helps'}
            <textarea
              rows={3}
              maxLength={5000}
              required
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              autoFocus={commentDraft.kind === 'comment'}
            />
          </label>
          {commentError && <p role="alert">{commentError}</p>}
          <div className="content-actions">
            <button type="submit" disabled={commentBusy || !commentBody.trim()}>
              {commentBusy ? 'Saving…' : 'Post review note'}
            </button>
            <button type="button" onClick={() => setCommentDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <section
        className="content-thread-list"
        aria-label="Review comments and suggestions"
      >
        <h4>
          Review notes <span>{threads.length}</span>
        </h4>
        {threadError && <p role="alert">{threadError}</p>}
        {commentError && !commentDraft && <p role="alert">{commentError}</p>}
        {threads.length === 0 && !threadError ? (
          <p className="seo-small-copy">
            Select text to leave a comment or suggest an edit.
          </p>
        ) : (
          threads.map((thread) => (
            <article
              key={thread.id}
              className={`content-thread-card ${activeThread === thread.id ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="content-thread-anchor"
                onClick={() => focusThread(thread)}
              >
                <span>
                  {thread.kind === 'comment' ? 'Comment' : 'Suggested edit'} ·{' '}
                  {thread.status}
                </span>
                <q>{thread.quotedText}</q>
              </button>
              <p>{thread.body}</p>
              {thread.kind === 'suggestion' && thread.suggestedText && (
                <div className="content-thread-suggestion">
                  <span>Replace with</span>
                  <q>{thread.suggestedText}</q>
                </div>
              )}
              <small>
                {thread.authorName} · {new Date(thread.createdAt).toLocaleString()}
              </small>
              {canComment && thread.status === 'open' && (
                <div className="content-actions">
                  {thread.kind === 'suggestion' ? (
                    <>
                      <button
                        disabled={commentBusy || !editable}
                        onClick={() => void acceptSuggestion(thread)}
                      >
                        Apply suggestion
                      </button>
                      <button
                        disabled={commentBusy}
                        onClick={() => void updateThreadStatus(thread, 'rejected')}
                      >
                        Decline
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={commentBusy}
                      onClick={() => void updateThreadStatus(thread, 'resolved')}
                    >
                      Resolve
                    </button>
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </section>
      {!editable && (
        <p className="seo-small-copy">
          You can follow the live draft and reviewer cursors. Editing is limited to the
          assigned writer and administrators.
        </p>
      )}
    </div>
  );
}
