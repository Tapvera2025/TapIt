import type { LinkPreview } from './api/chatApi.js';

/** A small mark per recognised product, so a Figma or Sheets link reads at a glance. */
const PROVIDER_MARK: Record<string, { label: string; className: string }> = {
  figma: { label: 'F', className: 'bg-[#1e1e1e]' },
  github: { label: 'GH', className: 'bg-[#24292f]' },
  loom: { label: 'L', className: 'bg-[#625df5]' },
  'google-docs': { label: 'D', className: 'bg-[#4285f4]' },
  'google-sheets': { label: 'S', className: 'bg-[#0f9d58]' },
  'google-slides': { label: 'P', className: 'bg-[#f4b400]' },
  'google-forms': { label: 'F', className: 'bg-[#7248b9]' },
  'google-drive': { label: 'G', className: 'bg-[#1a73e8]' },
  youtube: { label: '▶', className: 'bg-[#ff0000]' },
  notion: { label: 'N', className: 'bg-[#111111]' },
};

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function LinkPreviewCard({ preview }: { preview: LinkPreview }): React.JSX.Element {
  const mark = preview.provider ? PROVIDER_MARK[preview.provider] : undefined;
  const imageOnly = !preview.title && !preview.description && preview.imageUrl;
  const wide = preview.imageUrl && preview.imageWidth && preview.imageHeight && preview.imageWidth / preview.imageHeight >= 1.3;
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(event) => event.stopPropagation()}
      className="mt-1.5 block w-full max-w-sm overflow-hidden rounded-xl border border-app-border bg-app-surface/90 text-left transition-colors hover:border-app-accent/60"
    >
      {preview.imageUrl && (imageOnly || wide) && (
        <img src={preview.imageUrl} alt="" loading="lazy" decoding="async" className="aspect-[1.91] w-full bg-app-surface-raised object-cover" />
      )}
      {!imageOnly && (
        <div className="flex gap-2.5 border-l-[3px] border-app-accent/60 p-2.5">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-app-muted">
              {mark && <span className={`grid size-4 shrink-0 place-items-center rounded text-[8px] font-bold text-white ${mark.className}`} aria-hidden="true">{mark.label}</span>}
              <span className="truncate">{preview.siteName ?? host(preview.url)}</span>
            </p>
            {preview.title && <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-app-foreground">{preview.title}</p>}
            {preview.description && <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-app-muted">{preview.description}</p>}
          </div>
          {preview.imageUrl && !wide && (
            <img src={preview.imageUrl} alt="" loading="lazy" decoding="async" className="size-16 shrink-0 rounded-lg bg-app-surface-raised object-cover" />
          )}
        </div>
      )}
    </a>
  );
}
