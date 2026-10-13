import { useEffect, useState } from 'react';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

export function ReceiptPicker({
  files,
  onChange,
  onError,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    const urls = files.filter((file) => file.type.startsWith('image/')).map((file) => [file.name + file.lastModified, URL.createObjectURL(file)] as const);
    setPreviews(Object.fromEntries(urls));
    return () => urls.forEach(([, url]) => URL.revokeObjectURL(url));
  }, [files]);

  function addFiles(incoming: File[]): void {
    if (incoming.length + files.length > 3) {
      onError('You can upload a maximum of 3 receipts.');
      return;
    }
    const invalid = incoming.find((file) => !ACCEPTED.has(file.type));
    if (invalid) {
      onError(`${invalid.name}: upload a PDF, JPG, PNG, or WEBP receipt.`);
      return;
    }
    const tooLarge = incoming.find((file) => file.size > MAX_BYTES);
    if (tooLarge) {
      onError(`${tooLarge.name}: receipt must be 5 MB or smaller.`);
      return;
    }
    onError('');
    onChange([...files, ...incoming]);
  }

  return (
    <div className="sm:col-span-2">
      <p className="text-sm font-semibold">Receipts</p>
      <button
        type="button"
        disabled={disabled}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}
        onClick={() => document.getElementById('expense-receipts')?.click()}
        className={`mt-2 flex min-h-28 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${dragging ? 'border-app-accent bg-app-accent/10' : 'border-app-border bg-app-background hover:border-app-accent/60'} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className="text-sm font-semibold">Drop receipts here or choose files</span>
        <span className="mt-1 text-xs text-app-muted">PDF, JPG, PNG or WEBP · maximum 3 files · 5 MB each</span>
      </button>
      <input id="expense-receipts" className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple disabled={disabled} onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} />
      {files.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-3">{files.map((file, index) => <div className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface-raised p-2" key={`${file.name}-${file.lastModified}-${index}`}>{previews[file.name + file.lastModified] ? <img className="h-10 w-10 rounded object-cover" src={previews[file.name + file.lastModified]} alt="" /> : <span className="flex h-10 w-10 items-center justify-center rounded bg-app-accent/10 text-xs font-bold text-app-accent">PDF</span>}<span className="min-w-0 flex-1 truncate text-xs" title={file.name}>{file.name}</span><button type="button" className="rounded px-1.5 text-lg leading-none text-app-muted hover:bg-app-background hover:text-app-danger" onClick={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}>×</button></div>)}</div>}
    </div>
  );
}
