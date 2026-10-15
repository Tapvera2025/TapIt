import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import {
  createPipelineRound,
  deletePipelineRound,
  listPipelineRounds,
  reorderPipelineRounds,
  updatePipelineRound,
} from '../api/recruitmentApi.js';
import type { PipelineRound, PipelineRoundMode } from '../types/index.js';

const MODE_LABELS: Record<PipelineRoundMode, string> = {
  online: 'Online',
  offline: 'In-Person',
  phone: 'Phone',
};

const MODE_OPTIONS: { value: PipelineRoundMode; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'In-Person' },
  { value: 'phone', label: 'Phone' },
];

interface EditingRound {
  id: string | null; // null = new
  name: string;
  mode: PipelineRoundMode;
  interviewerNote: string;
}

function RoundRow({
  round,
  index,
  roundCount,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onEdit,
  onDelete,
}: {
  readonly round: PipelineRound;
  readonly index: number;
  readonly roundCount: number;
  readonly isDragging: boolean;
  readonly onDragStart: (index: number) => void;
  readonly onDragOver: (e: React.DragEvent, index: number) => void;
  readonly onDrop: (index: number) => void;
  readonly onEdit: (round: PipelineRound) => void;
  readonly onDelete: (round: PipelineRound) => void;
}): React.JSX.Element {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      className={`flex items-center gap-3 rounded-lg border bg-app-surface px-3 py-2.5 transition-opacity ${
        isDragging ? 'opacity-40' : 'opacity-100'
      } border-app-border`}
    >
      <span
        className="cursor-grab touch-none text-app-muted"
        title="Drag to reorder"
        aria-label="Drag handle"
      >
        <Icon name="grip" className="size-4" />
      </span>

      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-app-accent/10 text-xs font-bold text-app-accent">
        {index + 1}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-app-foreground">
          {round.name}
        </span>
        {round.interviewerNote && (
          <span className="block truncate text-xs text-app-muted">{round.interviewerNote}</span>
        )}
      </span>

      <span className="shrink-0 rounded-md border border-app-border/60 bg-app-background px-2 py-0.5 text-xs text-app-muted">
        {MODE_LABELS[round.mode]}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(round)}
          className="rounded p-1 text-app-muted hover:bg-app-background hover:text-app-foreground"
          title="Edit round"
        >
          <Icon name="pencil" className="size-3.5" />
        </button>
        {roundCount > 1 && (
          <button
            type="button"
            onClick={() => onDelete(round)}
            className="rounded p-1 text-app-muted hover:bg-red-50 hover:text-red-600"
            title="Delete round"
          >
            <Icon name="trash" className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function RoundForm({
  editing,
  onCancel,
  onSave,
  saving,
}: {
  readonly editing: EditingRound;
  readonly onCancel: () => void;
  readonly onSave: (data: EditingRound) => void;
  readonly saving: boolean;
}): React.JSX.Element {
  const [name, setName] = useState(editing.name);
  const [mode, setMode] = useState<PipelineRoundMode>(editing.mode);
  const [note, setNote] = useState(editing.interviewerNote);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ id: editing.id, name: name.trim(), mode, interviewerNote: note.trim() });
  }

  return (
    <form
      onSubmit={handleSave}
      className="space-y-3 rounded-lg border border-app-accent/30 bg-app-surface px-3 py-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">Round Name *</label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            required
            placeholder="e.g. Technical Screen, HR Discussion"
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">Mode *</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as PipelineRoundMode)}
            disabled={saving}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
          >
            {MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-app-muted">
          Interviewer Note (optional)
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={saving}
          placeholder="Brief note for interviewers assigned to this round"
          className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button kind="secondary" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button kind="primary" type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Saving...' : editing.id ? 'Update Round' : 'Add Round'}
        </Button>
      </div>
    </form>
  );
}

export function PipelineRoundBuilder({
  requisitionId,
}: {
  readonly requisitionId: string;
}): React.JSX.Element {
  const [rounds, setRounds] = useState<PipelineRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingRound | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const dragIndexRef = useRef<number | null>(null);
  const [dragActive, setDragActive] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listPipelineRounds(requisitionId);
      setRounds(data.slice().sort((a, b) => a.orderIndex - b.orderIndex));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pipeline rounds');
    } finally {
      setLoading(false);
    }
  }, [requisitionId]);

  useEffect(() => {
    void load();
  }, [load]);

  function startAdd() {
    setEditing({ id: null, name: '', mode: 'online', interviewerNote: '' });
  }

  function startEdit(round: PipelineRound) {
    setEditing({
      id: round.id,
      name: round.name,
      mode: round.mode,
      interviewerNote: round.interviewerNote ?? '',
    });
  }

  async function handleSave(data: EditingRound) {
    setSaving(true);
    setError(null);
    try {
      if (data.id) {
        const updated = await updatePipelineRound(requisitionId, data.id, {
          name: data.name,
          mode: data.mode,
          interviewerNote: data.interviewerNote || null,
        });
        setRounds((prev) =>
          prev.map((r) => (r.id === data.id ? updated : r)).sort((a, b) => a.orderIndex - b.orderIndex),
        );
      } else {
        const nextIndex = rounds.length > 0 ? Math.max(...rounds.map((r) => r.orderIndex)) + 1 : 1;
        const created = await createPipelineRound(requisitionId, {
          requisitionId,
          name: data.name,
          mode: data.mode,
          orderIndex: nextIndex,
          interviewerNote: data.interviewerNote || null,
        });
        setRounds((prev) => [...prev, created]);
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save round');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(round: PipelineRound) {
    if (!confirm('Delete round "' + round.name + '"? This cannot be undone.')) return;
    setDeleting(round.id);
    setError(null);
    try {
      await deletePipelineRound(requisitionId, round.id);
      setRounds((prev) => prev.filter((r) => r.id !== round.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete round');
    } finally {
      setDeleting(null);
    }
  }

  function handleDragStart(index: number) {
    dragIndexRef.current = index;
    setDragActive(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragActive(index);
  }

  async function handleDrop(dropIndex: number) {
    const fromIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragActive(null);

    if (fromIndex === null || fromIndex === dropIndex) return;

    const reordered = [...rounds];
    const [moved] = reordered.splice(fromIndex, 1);
    if (!moved) return;
    reordered.splice(dropIndex, 0, moved);

    const withNewOrder = reordered.map((r, i) => ({ ...r, orderIndex: i + 1 }));
    setRounds(withNewOrder);

    try {
      await reorderPipelineRounds(requisitionId, {
        rounds: withNewOrder.map((r) => ({ id: r.id, orderIndex: r.orderIndex })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder rounds');
      void load();
    }
  }

  if (loading) {
    return (
      <div className="py-4 text-center text-xs text-app-muted">Loading pipeline rounds...</div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 p-3 text-sm text-app-danger">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0 text-app-muted hover:text-app-foreground">
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
      )}

      {rounds.length === 0 && !editing && (
        <p className="text-xs text-app-muted">
          No rounds defined yet. Add rounds to build the interview pipeline for this requisition.
        </p>
      )}

      <div className="space-y-2">
        {rounds.map((round, i) => {
          if (editing?.id === round.id) {
            return (
              <RoundForm
                key={round.id}
                editing={editing}
                onCancel={() => setEditing(null)}
                onSave={(data) => void handleSave(data)}
                saving={saving}
              />
            );
          }
          return (
            <div key={round.id} className={deleting === round.id ? 'pointer-events-none opacity-50' : ''}>
              <RoundRow
                round={round}
                index={i}
                roundCount={rounds.length}
                isDragging={dragActive === i}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={(idx) => void handleDrop(idx)}
                onEdit={startEdit}
                onDelete={(r) => void handleDelete(r)}
              />
            </div>
          );
        })}
      </div>

      {editing?.id === null && (
        <RoundForm
          editing={editing}
          onCancel={() => setEditing(null)}
          onSave={(data) => void handleSave(data)}
          saving={saving}
        />
      )}

      {!editing && (
        <button
          type="button"
          onClick={startAdd}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-app-border py-2 text-xs text-app-muted transition-colors hover:border-app-accent hover:text-app-accent"
        >
          <Icon name="plus" className="size-3.5" />
          Add Round
        </button>
      )}
    </div>
  );
}
