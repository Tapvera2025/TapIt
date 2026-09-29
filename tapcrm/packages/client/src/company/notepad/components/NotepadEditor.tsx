import type { ChangeEvent } from 'react';

export interface NotepadEditorProps {
  readonly content: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly maxLength?: number;
}

export function NotepadEditor({
  content,
  onChange,
  disabled = false,
  maxLength = 50_000,
}: NotepadEditorProps): React.JSX.Element {
  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
  }

  return (
    <div className="w-full">
      <label htmlFor="notepad-editor-textarea" className="sr-only">
        Note editor
      </label>
      <textarea
        id="notepad-editor-textarea"
        value={content}
        onChange={handleChange}
        disabled={disabled}
        maxLength={maxLength}
        placeholder="Start typing your notes here..."
        className="w-full min-h-[340px] sm:min-h-[420px] md:min-h-[480px] resize-y rounded-xl border border-app-border bg-app-surface p-4 text-sm leading-relaxed text-app-foreground outline-none transition-colors focus:border-app-accent focus:ring-1 focus:ring-app-accent disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Note content"
        spellCheck="true"
      />
    </div>
  );
}
