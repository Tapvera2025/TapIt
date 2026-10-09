import { useCallback, useEffect, useState } from 'react';
import { Card, Notice, SkeletonNotepadPage } from '../../../ui/components.js';
import {
  clearNote,
  getCurrentNote,
  getNoteHistory,
  saveNote,
} from '../api/notepadApi.js';
import { ClearConfirmModal } from '../components/ClearConfirmModal.js';
import { NotepadEditor } from '../components/NotepadEditor.js';
import { NotepadHeader } from '../components/NotepadHeader.js';
import { NotepadStats } from '../components/NotepadStats.js';
import { NoteHistoryModal } from '../components/NoteHistoryModal.js';
import { NotePreviewModal } from '../components/NotePreviewModal.js';
import type {
  MyNotepadHistoryItem,
  SaveStatus,
} from '../types/index.js';

export const MAX_NOTE_CHARACTERS = 50_000;

export function MyNotepadPage(): React.JSX.Element {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [loadingNote, setLoadingNote] = useState(true);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // History state
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<MyNotepadHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Preview state
  const [previewItem, setPreviewItem] = useState<MyNotepadHistoryItem | null>(null);

  // Clear modal state
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Initial fetch of active notepad
  const loadActiveNote = useCallback(async () => {
    try {
      setLoadingNote(true);
      setGeneralError(null);
      setSaveStatus('loading');
      const note = await getCurrentNote();
      const currentText = note.content ?? '';
      setContent(currentText);
      setSavedContent(currentText);
      setSaveStatus('saved');
    } catch (err) {
      setGeneralError(
        err instanceof Error ? err.message : 'Unable to load notepad from server',
      );
      setSaveStatus('error');
    } finally {
      setLoadingNote(false);
    }
  }, []);

  useEffect(() => {
    void loadActiveNote();
  }, [loadActiveNote]);

  // Content change handler
  function handleContentChange(nextText: string) {
    setContent(nextText);
    if (generalError) {
      setGeneralError(null);
    }
    if (nextText === savedContent) {
      setSaveStatus('saved');
    } else {
      setSaveStatus('unsaved');
    }
  }

  // Save handler
  async function handleSave() {
    if (saveStatus === 'saving' || loadingNote) return;
    try {
      setSaveStatus('saving');
      setGeneralError(null);
      const savedNote = await saveNote({ content });
      setSavedContent(savedNote.content);
      setSaveStatus('saved');
    } catch (err) {
      setGeneralError(
        err instanceof Error ? err.message : 'Failed to save notepad',
      );
      setSaveStatus('error');
    }
  }

  // Clear handler
  async function handleConfirmClear() {
    try {
      setIsClearing(true);
      setGeneralError(null);
      const result = await clearNote();
      const emptyContent = result.content ?? '';
      setContent(emptyContent);
      setSavedContent(emptyContent);
      setSaveStatus('saved');
      setIsClearConfirmOpen(false);
    } catch (err) {
      setGeneralError(
        err instanceof Error ? err.message : 'Failed to clear note',
      );
    } finally {
      setIsClearing(false);
    }
  }

  // Load history snapshots
  const loadHistory = useCallback(async () => {
    try {
      setLoadingHistory(true);
      setHistoryError(null);
      const items = await getNoteHistory();
      setHistoryItems(items);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : 'Unable to load note history',
      );
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  function handleOpenHistory() {
    setIsHistoryOpen(true);
    void loadHistory();
  }

  function handleSelectHistoryItem(item: MyNotepadHistoryItem) {
    setIsHistoryOpen(false);
    setPreviewItem(item);
  }

  function handleBackToHistory() {
    setPreviewItem(null);
    setIsHistoryOpen(true);
  }

  // Statistics calculation
  const charCount = content.length;
  const wordCount =
    content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length;
  const lineCount = content.length === 0 ? 0 : content.split('\n').length;

  if (loadingNote && !generalError) return <div className="p-4 sm:p-6 md:p-8"><SkeletonNotepadPage /></div>;

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Error notification banner if any */}
        {generalError && (
          <Notice error>
            <div className="flex items-center justify-between gap-2">
              <span>{generalError}</span>
              <button
                type="button"
                onClick={() => setGeneralError(null)}
                className="text-xs underline hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          </Notice>
        )}

        {/* Main Notepad Card */}
        <Card className="space-y-4 p-4 sm:p-6 md:p-8">
          {/* Header */}
          <NotepadHeader
            saveStatus={saveStatus}
            onOpenHistory={handleOpenHistory}
            disabled={loadingNote}
          />

          {/* Editor Area */}
          <NotepadEditor
            content={content}
            onChange={handleContentChange}
            disabled={loadingNote}
            maxLength={MAX_NOTE_CHARACTERS}
          />

          {/* Statistics and Save/Clear Actions */}
          <NotepadStats
            characterCount={charCount}
            maxCharacters={MAX_NOTE_CHARACTERS}
            wordCount={wordCount}
            lineCount={lineCount}
            onSave={() => void handleSave()}
            onClear={() => setIsClearConfirmOpen(true)}
            isSaving={saveStatus === 'saving'}
            isLoading={loadingNote}
            isClearDisabled={content.length === 0}
            isSaveDisabled={content === savedContent && saveStatus === 'saved'}
          />
        </Card>

        {/* Note History Modal */}
        <NoteHistoryModal
          isOpen={isHistoryOpen}
          history={historyItems}
          loading={loadingHistory}
          error={historyError}
          onSelect={handleSelectHistoryItem}
          onRetry={() => void loadHistory()}
          onClose={() => setIsHistoryOpen(false)}
        />

        {/* History Snapshot Preview Modal */}
        <NotePreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onBackToHistory={handleBackToHistory}
        />

        {/* Clear Confirmation Modal */}
        <ClearConfirmModal
          isOpen={isClearConfirmOpen}
          isClearing={isClearing}
          onConfirm={() => void handleConfirmClear()}
          onClose={() => setIsClearConfirmOpen(false)}
        />
      </div>
    </div>
  );
}
