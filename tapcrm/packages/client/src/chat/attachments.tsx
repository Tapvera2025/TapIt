import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/index.js';
import type { AttachmentKind, MessageAttachment } from './api/chatApi.js';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

const BADGE: Record<AttachmentKind, { label: string; className: string }> = {
  image: { label: 'IMG', className: 'bg-[#0ea5e9]' },
  pdf: { label: 'PDF', className: 'bg-[#dc2626]' },
  document: { label: 'DOC', className: 'bg-[#2563eb]' },
  spreadsheet: { label: 'XLS', className: 'bg-[#16a34a]' },
  presentation: { label: 'PPT', className: 'bg-[#ea580c]' },
  text: { label: 'TXT', className: 'bg-[#64748b]' },
  archive: { label: 'ZIP', className: 'bg-[#7c3aed]' },
};

function extensionLabel(fileName: string, kind: AttachmentKind): string {
  const extension = fileName.split('.').pop()?.toUpperCase() ?? '';
  return extension && extension.length <= 4 ? extension : BADGE[kind].label;
}

export function FileBadge({ kind, fileName, className = 'size-10' }: { kind: AttachmentKind; fileName: string; className?: string }): React.JSX.Element {
  return (
    <span className={`grid shrink-0 place-items-center rounded-lg text-[10px] font-bold tracking-wide text-white ${BADGE[kind].className} ${className}`} aria-hidden="true">
      {extensionLabel(fileName, kind)}
    </span>
  );
}

function describe(attachment: MessageAttachment): string {
  const parts = [extensionLabel(attachment.fileName, attachment.kind)];
  if (attachment.pageCount) parts.push(`${attachment.pageCount} page${attachment.pageCount === 1 ? '' : 's'}`);
  parts.push(formatBytes(attachment.sizeBytes));
  return parts.join(' · ');
}

/** One non-image file: type badge, name, size; opens (PDF) or downloads on click. */
export function FileCard({ attachment }: { attachment: MessageAttachment }): React.JSX.Element {
  const opensInline = attachment.kind === 'pdf';
  return (
    <div className="flex w-full min-w-0 max-w-sm items-center gap-3 rounded-xl border border-app-border bg-app-surface/80 p-2.5">
      <FileBadge kind={attachment.kind} fileName={attachment.fileName} />
      <a
        href={opensInline ? attachment.url : attachment.downloadUrl}
        target={opensInline ? '_blank' : undefined}
        rel="noopener noreferrer"
        className="min-w-0 flex-1 hover:underline"
        onClick={(event) => event.stopPropagation()}
        title={attachment.fileName}
      >
        <span className="block truncate text-sm font-medium text-app-foreground">{attachment.fileName}</span>
        <span className="block truncate text-[11px] text-app-muted">{describe(attachment)}</span>
      </a>
      <a
        href={attachment.downloadUrl}
        download={attachment.fileName}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-app-muted hover:bg-app-surface-raised hover:text-app-accent"
        aria-label={`Download ${attachment.fileName}`}
        title="Download"
        onClick={(event) => event.stopPropagation()}
      >
        <Icon name="download" className="size-4" />
      </a>
    </div>
  );
}

/** A message's files: images as a thumbnail grid (opening the lightbox), everything else as cards. */
export function AttachmentGallery({ attachments, onOpenImage }: { attachments: readonly MessageAttachment[]; onOpenImage: (images: MessageAttachment[], index: number) => void }): React.JSX.Element | null {
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) => attachment.kind === 'image');
  const files = attachments.filter((attachment) => attachment.kind !== 'image');
  const single = images.length === 1;
  return (
    <div className="mb-1 flex min-w-0 flex-col gap-1.5">
      {images.length > 0 && (
        <div className={`grid gap-1 ${single ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {images.slice(0, 4).map((image, index) => {
            const hidden = index === 3 && images.length > 4 ? images.length - 4 : 0;
            const ratio = image.width && image.height ? image.width / image.height : 4 / 3;
            return (
              <button
                key={image.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenImage(images, index);
                }}
                className="group/img relative overflow-hidden rounded-xl bg-app-surface-raised focus-visible:outline-2 focus-visible:outline-app-accent"
                style={single ? { aspectRatio: `${Math.min(Math.max(ratio, 0.6), 2)}`, width: 'min(300px, 62vw)' } : { aspectRatio: '1', width: 'min(146px, 30vw)' }}
                aria-label={`Open ${image.fileName}`}
              >
                <img
                  src={image.thumbnailUrl ?? image.url}
                  alt={image.fileName}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="size-full object-cover transition-transform duration-200 group-hover/img:scale-[1.02]"
                />
                {hidden > 0 && (
                  <span className="absolute inset-0 grid place-items-center bg-black/55 text-xl font-semibold text-white">+{hidden}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {files.map((file) => <FileCard key={file.id} attachment={file} />)}
    </div>
  );
}

/** Full-screen image viewer: ←/→ between the message's images, Esc to close, click to zoom. */
export function Lightbox({ images, startIndex, onClose }: { images: readonly MessageAttachment[]; startIndex: number; onClose: () => void }): React.JSX.Element | null {
  const [index, setIndex] = useState(startIndex);
  const [zoomed, setZoomed] = useState(false);
  const image = images[index];
  const count = images.length;
  const go = useCallback((delta: number) => {
    setZoomed(false);
    setIndex((current) => (current + delta + count) % count);
  }, [count]);

  // Added once, so a parent re-render (a new `onClose`) cannot drop the Escape that caused it.
  const onKey = useEffectEvent((event: KeyboardEvent): void => {
    if (event.key === 'Escape') onClose();
    else if (event.key === 'ArrowRight' && count > 1) go(1);
    else if (event.key === 'ArrowLeft' && count > 1) go(-1);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => onKey(event);
    document.addEventListener('keydown', listener);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', listener);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!image) return null;
  return createPortal(
    <div data-chat-popover className="fixed inset-0 z-[70] flex flex-col bg-black/90 text-white" role="dialog" aria-modal="true" aria-label={image.fileName}>
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{image.fileName}</p>
          <p className="text-xs text-white/60">
            {count > 1 ? `${index + 1} of ${count} · ` : ''}
            {image.width && image.height ? `${image.width} × ${image.height} · ` : ''}
            {formatBytes(image.sizeBytes)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a href={image.url} target="_blank" rel="noopener noreferrer" className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Open original in a new tab" title="Open original">
            <Icon name="external-link" className="size-5" />
          </a>
          <a href={image.downloadUrl} download={image.fileName} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Download" title="Download">
            <Icon name="download" className="size-5" />
          </a>
          <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Close" title="Close (Esc)">
            <Icon name="close" className="size-5" />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={onClose}>
        {count > 1 && (
          <button type="button" onClick={(event) => { event.stopPropagation(); go(-1); }} className="absolute left-2 z-10 grid size-11 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:left-4" aria-label="Previous image">
            <Icon name="chevron-left" className="size-6" />
          </button>
        )}
        <div data-lenis-prevent className={`max-h-full max-w-full ${zoomed ? 'overflow-auto' : 'overflow-hidden'} p-2`} onClick={(event) => event.stopPropagation()}>
          <img
            key={image.id}
            src={image.url}
            alt={image.fileName}
            onClick={() => setZoomed((value) => !value)}
            className={zoomed ? 'max-w-none cursor-zoom-out' : 'max-h-[calc(100vh-7rem)] max-w-[calc(100vw-2rem)] cursor-zoom-in object-contain'}
          />
        </div>
        {count > 1 && (
          <button type="button" onClick={(event) => { event.stopPropagation(); go(1); }} className="absolute right-2 z-10 grid size-11 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:right-4" aria-label="Next image">
            <Icon name="chevron-right" className="size-6" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ *
 * Composer tray
 * ------------------------------------------------------------------ */

export interface PendingUpload {
  /** Local key (stable before the server assigns an id). */
  readonly key: string;
  readonly file: File;
  readonly previewUrl: string | null;
  readonly progress: number;
  readonly attachment: MessageAttachment | null;
  readonly error: string | null;
}

export function PendingUploads({ uploads, onRemove }: { uploads: readonly PendingUpload[]; onRemove: (key: string) => void }): React.JSX.Element | null {
  if (uploads.length === 0) return null;
  return (
    <div data-lenis-prevent className="flex gap-2 overflow-x-auto px-1 pb-2 pt-1">
      {uploads.map((upload) => {
        const kind = upload.attachment?.kind ?? (upload.file.type.startsWith('image/') ? 'image' : 'document');
        return (
          <div key={upload.key} className={`relative flex w-56 shrink-0 items-center gap-2 rounded-xl border bg-app-surface p-2 ${upload.error ? 'border-app-danger/60' : 'border-app-border'}`}>
            {upload.previewUrl ? (
              <img src={upload.previewUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
            ) : (
              <FileBadge kind={kind} fileName={upload.file.name} />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium" title={upload.file.name}>{upload.file.name}</p>
              {upload.error ? (
                <p className="line-clamp-2 text-[11px] text-app-danger">{upload.error}</p>
              ) : upload.attachment ? (
                <p className="text-[11px] text-app-muted">{formatBytes(upload.attachment.sizeBytes)} · ready</p>
              ) : (
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-app-surface-raised" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(upload.progress * 100)}>
                  <div className="h-full rounded-full bg-app-accent transition-[width]" style={{ width: `${Math.max(4, Math.round(upload.progress * 100))}%` }} />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onRemove(upload.key)}
              className="grid size-6 shrink-0 place-items-center rounded-full text-app-muted hover:bg-app-surface-raised hover:text-app-danger"
              aria-label={`Remove ${upload.file.name}`}
            >
              <Icon name="close" className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
