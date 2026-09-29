import { Button } from '../../../ui/components.js';

export interface NotepadStatsProps {
  readonly characterCount: number;
  readonly maxCharacters: number;
  readonly wordCount: number;
  readonly lineCount: number;
  readonly onSave: () => void;
  readonly onClear: () => void;
  readonly isSaving?: boolean;
  readonly isLoading?: boolean;
  readonly isClearDisabled?: boolean;
  readonly isSaveDisabled?: boolean;
}

export function NotepadStats({
  characterCount,
  maxCharacters,
  wordCount,
  lineCount,
  onSave,
  onClear,
  isSaving = false,
  isLoading = false,
  isClearDisabled = false,
  isSaveDisabled = false,
}: NotepadStatsProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 border-t border-app-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Live Statistics Counter */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-left">
        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-app-muted">
            Characters
          </span>
          <span className="text-sm font-bold text-app-foreground">
            {characterCount.toLocaleString()} / {maxCharacters.toLocaleString()}
          </span>
        </div>

        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-app-muted">
            Words
          </span>
          <span className="text-sm font-bold text-app-foreground">
            {wordCount.toLocaleString()}
          </span>
        </div>

        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-app-muted">
            Lines
          </span>
          <span className="text-sm font-bold text-app-foreground">
            {lineCount.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 w-full sm:w-auto">
        <Button
          type="button"
          kind="secondary"
          onClick={onClear}
          disabled={isLoading || isSaving || isClearDisabled}
          className="text-xs border-[#d86b6b]/40 text-app-danger hover:bg-[#d86b6b]/10 hover:border-[#d86b6b]"
          aria-label="Clear current note"
        >
          Clear
        </Button>

        <Button
          type="button"
          kind="primary"
          onClick={onSave}
          disabled={isLoading || isSaving || isSaveDisabled}
          className="min-w-20 text-xs"
          aria-label="Save note"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
