import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Button, Icon } from '../ui/index.js';
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_MB,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type ChatMessage,
  type Conversation,
  type ConversationKind,
  type ConversationMember,
  type ScheduledMessage,
} from './api/chatApi.js';
import { PendingUploads, type PendingUpload } from './attachments.js';
import { Avatar } from './Avatar.js';
import { EmojiPopover } from './emoji/EmojiPicker.js';
import { applyFormat, toPlainText, type FormatAction } from './markdown.js';
import { SchedulePicker } from './SchedulePicker.js';
import type { ChatTransport } from './transport.js';

const MAX_COMPOSER_HEIGHT = 200;
const ALLOWED = new Set(ATTACHMENT_ACCEPT.split(','));

const TOOLBAR: readonly { action: FormatAction; label: string; hint: string; glyph: string }[] = [
  { action: 'bold', label: 'Bold', hint: 'Ctrl+B', glyph: 'B' },
  { action: 'italic', label: 'Italic', hint: 'Ctrl+I', glyph: 'I' },
  { action: 'strike', label: 'Strikethrough', hint: 'Ctrl+Shift+X', glyph: 'S' },
  { action: 'code', label: 'Inline code', hint: 'Ctrl+E', glyph: '</>' },
  { action: 'codeblock', label: 'Code block', hint: 'Ctrl+Alt+C', glyph: '{ }' },
  { action: 'bullet', label: 'Bulleted list', hint: '', glyph: '•' },
  { action: 'numbered', label: 'Numbered list', hint: '', glyph: '1.' },
  { action: 'quote', label: 'Quote', hint: '', glyph: '❝' },
];

function insideCodeBlock(text: string, cursor: number): boolean {
  return (text.slice(0, cursor).match(/```/g)?.length ?? 0) % 2 === 1;
}

let uploadSequence = 0;

/**
 * The message box: Markdown formatting (toolbar + shortcuts), emoji, files
 * (button, drag-and-drop onto the thread, paste), @mentions in groups,
 * reply, edit-in-place and Send later.
 */
export function Composer({
  conversation,
  kind,
  currentUserId,
  transport,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onSent,
  onEdited,
  onScheduled,
  onTyping,
  onError,
  onEditLast,
  fileDropRef,
  clientMode,
}: {
  conversation: Conversation;
  kind: ConversationKind;
  currentUserId: string;
  transport: ChatTransport;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  editing: ChatMessage | null;
  onCancelEdit: () => void;
  onSent: (message: ChatMessage) => void;
  onEdited: (message: ChatMessage) => void;
  onScheduled: (scheduled: ScheduledMessage) => void;
  onTyping: (state: 'start' | 'stop') => void;
  onError: (message: string) => void;
  /** ↑ in an empty box: edit my last message. */
  onEditLast: () => void;
  /** The thread registers dropped files here. */
  fileDropRef: MutableRefObject<((files: File[]) => void) | null>;
  clientMode: boolean;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [sending, setSending] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<DOMRect | null>(null);
  const [scheduleAnchor, setScheduleAnchor] = useState<DOMRect | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pendingMentions, setPendingMentions] = useState<Map<string, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const uploadsRef = useRef<PendingUpload[]>([]);
  uploadsRef.current = uploads;
  const conversationId = conversation.id;

  // A different conversation starts with a clean box (drafts are not carried across).
  useEffect(() => {
    setText('');
    setPendingMentions(new Map());
    setMentionQuery(null);
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    setUploads((current) => {
      for (const upload of current) if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
      return [];
    });
  }, [conversationId]);

  // Entering edit mode loads the message text; leaving it clears the box.
  useEffect(() => {
    if (editing) {
      setText(editing.body ?? '');
      setPendingMentions(new Map(editing.mentions.map((m) => [m.userId, m.fullName])));
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    }
  }, [editing]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [text]);

  useEffect(() => () => {
    for (const controller of controllers.current.values()) controller.abort();
    for (const upload of uploadsRef.current) if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
  }, []);

  const patchUpload = (key: string, patch: Partial<PendingUpload>): void => {
    setUploads((current) => current.map((upload) => (upload.key === key ? { ...upload, ...patch } : upload)));
  };

  const addFiles = useCallback((files: File[]): void => {
    if (editing) {
      onError('Files cannot be added while editing a message.');
      return;
    }
    const room = MAX_ATTACHMENTS_PER_MESSAGE - uploadsRef.current.length;
    if (files.length > room) onError(`A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} files.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      uploadSequence += 1;
      const key = `upload-${uploadSequence}`;
      const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
      const tooBig = file.size > MAX_ATTACHMENT_MB * 1024 * 1024;
      const unsupported = !ALLOWED.has(extension);
      const previewUrl = !tooBig && !unsupported && /^image\/(png|jpe?g|gif|webp)$/.test(file.type) ? URL.createObjectURL(file) : null;
      const error = tooBig
        ? `Larger than ${MAX_ATTACHMENT_MB} MB`
        : unsupported
          ? `${extension === '.' ? 'Files without an extension' : `${extension} files`} can't be shared`
          : file.size === 0 ? 'The file is empty' : null;
      setUploads((current) => [...current, { key, file, previewUrl, progress: 0, attachment: null, error }]);
      if (error) continue;
      const controller = new AbortController();
      controllers.current.set(key, controller);
      void transport.uploadAttachment(conversationId, file, (fraction) => patchUpload(key, { progress: fraction }), controller.signal)
        .then((attachment) => patchUpload(key, { attachment, progress: 1 }))
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          patchUpload(key, { error: cause instanceof Error ? cause.message : 'Upload failed' });
        })
        .finally(() => controllers.current.delete(key));
    }
  }, [conversationId, editing, onError, transport]);

  useEffect(() => {
    fileDropRef.current = addFiles;
    return () => {
      fileDropRef.current = null;
    };
  }, [addFiles, fileDropRef]);

  const removeUpload = (key: string): void => {
    const upload = uploadsRef.current.find((item) => item.key === key);
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    if (upload?.previewUrl) URL.revokeObjectURL(upload.previewUrl);
    if (upload?.attachment) void transport.deletePendingAttachment(conversationId, upload.attachment.id).catch(() => undefined);
    setUploads((current) => current.filter((item) => item.key !== key));
  };

  const members = conversation.members;
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return members.filter((m) => m.userId !== currentUserId && m.fullName.toLowerCase().includes(query)).slice(0, 6);
  }, [mentionQuery, members, currentUserId]);

  const onChange = (value: string, cursor: number): void => {
    setText(value);
    if (!editing) {
      onTyping('start');
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => onTyping('stop'), 2000);
    }
    if (kind === 'direct') return;
    const upToCursor = value.slice(0, cursor);
    const at = upToCursor.lastIndexOf('@');
    const fragment = at === -1 ? null : upToCursor.slice(at + 1);
    const valid = fragment !== null && (at === 0 || /\s/.test(upToCursor[at - 1] ?? ' ')) && !/\s{2}|\n/.test(fragment) && fragment.length <= 40;
    setMentionQuery(valid ? fragment : null);
    setMentionIndex(0);
  };

  const selectMention = (member: ConversationMember): void => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const upToCursor = text.slice(0, cursor);
    const at = upToCursor.lastIndexOf('@');
    if (at === -1) return;
    const insertion = `@${member.fullName} `;
    setText(text.slice(0, at) + insertion + text.slice(cursor));
    setPendingMentions((current) => new Map(current).set(member.userId, member.fullName));
    setMentionQuery(null);
    const pos = at + insertion.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const format = (action: FormatAction): void => {
    const el = textareaRef.current;
    if (!el) return;
    const next = applyFormat(text, el.selectionStart, el.selectionEnd, action);
    setText(next.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  const insertText = (insertion: string): void => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + insertion + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  };

  const uploading = uploads.some((upload) => !upload.attachment && !upload.error);
  const readyIds = uploads.filter((upload) => upload.attachment && !upload.error).map((upload) => upload.attachment!.id);
  const body = text.trim();
  const canSend = !sending && !uploading && (body.length > 0 || readyIds.length > 0 || (editing !== null && (editing.attachments?.length ?? 0) > 0));

  const mentionedIds = (): string[] => [...pendingMentions.entries()].filter(([, fullName]) => body.includes(`@${fullName}`)).map(([userId]) => userId);

  const reset = (): void => {
    setText('');
    setPendingMentions(new Map());
    setMentionQuery(null);
    for (const upload of uploads) if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
    setUploads([]);
  };

  const submit = async (): Promise<void> => {
    if (!canSend) return;
    setSending(true);
    onTyping('stop');
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    try {
      if (editing) {
        if (body === (editing.body ?? '').trim()) {
          onCancelEdit();
          reset();
          return;
        }
        onEdited(await transport.editMessage(conversationId, editing.id, body, mentionedIds()));
        onCancelEdit();
        reset();
        return;
      }
      const message = await transport.sendMessage(conversationId, {
        body,
        replyToMessageId: replyTo?.id ?? null,
        mentionedUserIds: mentionedIds(),
        attachmentIds: readyIds,
      });
      onSent(message);
      reset();
      onCancelReply();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : editing ? 'Unable to save the edit.' : 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  const schedule = async (sendAt: Date): Promise<void> => {
    if (!transport.scheduleMessage || editing) return;
    setScheduleAnchor(null);
    if (!body && readyIds.length === 0) {
      onError('Write a message (or add a file) to schedule.');
      return;
    }
    setSending(true);
    try {
      const scheduled = await transport.scheduleMessage(conversationId, {
        body,
        replyToMessageId: replyTo?.id ?? null,
        mentionedUserIds: mentionedIds(),
        attachmentIds: readyIds,
        sendAt: sendAt.toISOString(),
      });
      onScheduled(scheduled);
      reset();
      onCancelReply();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Unable to schedule the message.');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const el = event.currentTarget;
    const mod = event.metaKey || event.ctrlKey;
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const member = mentionCandidates[mentionIndex];
        if (member) selectMention(member);
        return;
      }
    }
    if (event.key === 'Escape') {
      if (mentionQuery !== null) setMentionQuery(null);
      else if (editing) {
        onCancelEdit();
        reset();
      } else if (replyTo) onCancelReply();
      return;
    }
    if (mod && !event.altKey && event.key.toLowerCase() === 'b') { event.preventDefault(); format('bold'); return; }
    if (mod && !event.altKey && event.key.toLowerCase() === 'i') { event.preventDefault(); format('italic'); return; }
    if (mod && !event.altKey && event.key.toLowerCase() === 'e') { event.preventDefault(); format('code'); return; }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'x') { event.preventDefault(); format('strike'); return; }
    if (mod && event.altKey && event.code === 'KeyC') { event.preventDefault(); format('codeblock'); return; }
    if (event.key === 'ArrowUp' && !text && !editing && uploads.length === 0) {
      event.preventDefault();
      onEditLast();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      // Inside an open ``` block, Enter is a new line (as in Slack).
      if (insideCodeBlock(el.value, el.selectionStart)) return;
      event.preventDefault();
      void submit();
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files.map((file, index) => (file.name && file.name !== 'image.png'
      ? file
      : new File([file], `Pasted image ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${index ? `-${index}` : ''}.png`, { type: file.type }))));
  };

  return (
    <div className={`shrink-0 border-t border-app-border bg-app-surface ${clientMode ? 'px-3 pb-3 pt-2 sm:px-4 sm:pb-4' : 'px-3 pb-3 pt-2'}`}>
      {editing && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-app-accent/10 px-3 py-1.5 text-xs text-app-accent">
          <span className="flex min-w-0 items-center gap-1.5 truncate"><Icon name="pencil" className="size-3.5 shrink-0" /> Editing message · Esc to cancel</span>
          <button type="button" onClick={() => { onCancelEdit(); reset(); }} className="shrink-0 font-semibold hover:underline">Cancel</button>
        </div>
      )}
      {replyTo && !editing && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border-l-[3px] border-app-accent bg-app-surface-raised px-3 py-1.5 text-xs text-app-muted">
          <span className="min-w-0 truncate">
            <span className="font-semibold text-app-foreground">Replying to {members.find((m) => m.userId === replyTo.senderId)?.fullName ?? 'message'}: </span>
            {replyTo.deletedAt ? 'Message unsent' : toPlainText(replyTo.body ?? '') || ((replyTo.attachments?.length ?? 0) > 0 ? '📎 File' : '')}
          </span>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="grid size-5 shrink-0 place-items-center rounded hover:bg-app-surface"><Icon name="close" className="size-3.5" /></button>
        </div>
      )}
      <PendingUploads uploads={uploads} onRemove={removeUpload} />
      {showToolbar && (
        <div className="mb-1.5 flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
          {TOOLBAR.map((item) => (
            <button
              key={item.action}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format(item.action)}
              title={item.hint ? `${item.label} (${item.hint})` : item.label}
              aria-label={item.label}
              className={`grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-xs text-app-muted hover:bg-app-surface-raised hover:text-app-foreground ${item.action === 'bold' ? 'font-bold' : ''} ${item.action === 'italic' ? 'italic' : ''} ${item.action === 'strike' ? 'line-through' : ''} ${item.action === 'code' || item.action === 'codeblock' ? 'font-mono' : ''}`}
            >
              {item.glyph}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5 sm:gap-2">
        <div className="flex shrink-0 items-center pb-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(editing)}
            className="grid size-8 place-items-center rounded-lg text-app-muted hover:bg-app-surface-raised hover:text-app-accent disabled:opacity-40"
            aria-label="Attach files"
            title={`Attach files (up to ${MAX_ATTACHMENTS_PER_MESSAGE}, ${MAX_ATTACHMENT_MB} MB each)`}
          >
            <Icon name="paperclip" className="size-[18px]" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => setShowToolbar((value) => !value)}
            className={`hidden size-8 place-items-center rounded-lg text-sm font-semibold hover:bg-app-surface-raised sm:grid ${showToolbar ? 'text-app-accent' : 'text-app-muted hover:text-app-accent'}`}
            aria-label={showToolbar ? 'Hide formatting' : 'Show formatting'}
            aria-pressed={showToolbar}
            title="Formatting"
          >
            Aa
          </button>
        </div>
        <div className="relative min-w-0 flex-1">
          {mentionQuery !== null && (
            <div data-chat-popover className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-lg border border-app-border bg-app-surface py-1 text-sm shadow-lg" role="listbox">
              {mentionCandidates.length === 0 ? (
                <p className="px-3 py-1.5 text-xs text-app-muted">No matching members</p>
              ) : (
                mentionCandidates.map((member, index) => (
                  <button
                    key={member.userId}
                    type="button"
                    role="option"
                    aria-selected={index === mentionIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectMention(member)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-app-surface-raised ${index === mentionIndex ? 'bg-app-surface-raised' : ''}`}
                  >
                    <Avatar name={member.fullName} seed={member.userId} size="xs" />
                    <span className="truncate">{member.fullName}</span>
                  </button>
                ))
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={editing ? 'Edit your message' : uploads.length > 0 ? 'Add a message (optional)' : 'Type a message…'}
            rows={1}
            style={{ maxHeight: MAX_COMPOSER_HEIGHT }}
            data-lenis-prevent
            aria-label="Message"
            className={`block min-h-10 w-full resize-none overflow-y-auto whitespace-pre-wrap border border-app-border py-2.5 pl-3 pr-10 text-sm leading-5 outline-none focus:border-app-accent ${clientMode ? 'rounded-xl bg-app-surface-raised' : 'rounded-lg bg-app-background'}`}
          />
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => setEmojiAnchor(emojiAnchor ? null : event.currentTarget.getBoundingClientRect())}
            className="absolute bottom-1.5 right-1.5 grid size-7 place-items-center rounded-md text-app-muted hover:bg-app-surface-raised hover:text-app-accent"
            aria-label="Insert emoji"
            title="Emoji"
          >
            <Icon name="smile" className="size-[18px]" />
          </button>
        </div>
        <div className="flex shrink-0 items-stretch">
          <Button
            onClick={() => void submit()}
            disabled={!canSend}
            className={`h-10 min-w-[4.25rem] !py-0 ${transport.scheduleMessage && !editing ? '!rounded-r-none' : ''} ${clientMode ? '!rounded-l-xl !px-4' : ''}`}
            title={uploading ? 'Waiting for files to finish uploading' : undefined}
          >
            {editing ? 'Save' : uploading ? 'Uploading…' : 'Send'}
          </Button>
          {transport.scheduleMessage && !editing && (
            <button
              type="button"
              onClick={(event) => setScheduleAnchor(scheduleAnchor ? null : event.currentTarget.getBoundingClientRect())}
              disabled={sending || uploading}
              className="grid h-10 w-8 place-items-center rounded-r-lg border-l border-white/25 bg-app-accent text-app-on-accent hover:brightness-110 disabled:opacity-50"
              aria-label="Send later"
              title="Send later"
            >
              <Icon name="clock" className="size-4" />
            </button>
          )}
        </div>
      </div>

      {emojiAnchor && (
        <EmojiPopover
          anchor={emojiAnchor}
          onSelect={(emoji) => insertText(emoji)}
          onClose={() => setEmojiAnchor(null)}
        />
      )}
      {scheduleAnchor && (
        <SchedulePicker anchor={scheduleAnchor} onPick={(date) => void schedule(date)} onClose={() => setScheduleAnchor(null)} />
      )}
    </div>
  );
}
