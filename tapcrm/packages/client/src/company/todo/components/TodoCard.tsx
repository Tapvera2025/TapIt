import { Card } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import type { MyTodo, TodoPriority } from '../types/index.js';

export interface TodoCardProps {
  readonly todo: MyTodo;
  readonly onComplete: (id: string) => void;
  readonly onReopen: (id: string) => void;
  readonly onEdit: (todo: MyTodo) => void;
  readonly onDelete: (id: string) => void;
  readonly isMutating?: boolean;
}

function PriorityBadge({ priority }: { priority: TodoPriority }): React.JSX.Element {
  const styles =
    priority === 'high'
      ? 'border-[#d86b6b]/40 bg-[#d86b6b]/10 text-app-danger'
      : priority === 'medium'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : 'border-app-border bg-app-surface-raised text-app-muted';

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${styles}`}
    >
      {priority}
    </span>
  );
}

export function TodoCard({
  todo,
  onComplete,
  onReopen,
  onEdit,
  onDelete,
  isMutating = false,
}: TodoCardProps): React.JSX.Element {
  const isCompleted = todo.status === 'completed';

  return (
    <Card
      className={`p-2.5 sm:p-3 transition-colors min-w-0 max-w-full ${
        isCompleted
          ? 'opacity-70 bg-app-surface/50 border-app-border/70 hover:opacity-100'
          : 'hover:border-app-accent/40 hover:bg-app-surface-raised'
      }`}
    >
      <div className="flex items-center justify-between gap-2.5 sm:gap-3 min-w-0 max-w-full">
        {/* Left: Checkbox + Info */}
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
          {/* Checkbox */}
          <button
            type="button"
            disabled={isMutating}
            onClick={() => {
              if (isCompleted) {
                onReopen(todo.id);
              } else {
                onComplete(todo.id);
              }
            }}
            className={`mt-0.5 sm:mt-0 grid size-5 shrink-0 place-items-center rounded border transition ${
              isCompleted
                ? 'border-app-accent bg-app-accent text-white'
                : 'border-app-border bg-app-background hover:border-app-accent'
            } disabled:opacity-50`}
            aria-label={isCompleted ? 'Mark todo as pending' : 'Mark todo as completed'}
          >
            {isCompleted && <Icon name="check" className="size-3.5 stroke-[2.5]" />}
          </button>

          {/* Text & Metadata */}
          <div className="min-w-0 flex-1">
            {/* Title & Priority Row */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0 max-w-full">
              <h3
                className={`text-xs sm:text-sm font-semibold min-w-0 max-w-full break-words [overflow-wrap:anywhere] sm:truncate ${
                  isCompleted
                    ? 'text-app-muted line-through'
                    : 'text-app-foreground'
                }`}
              >
                {todo.title}
              </h3>
              <PriorityBadge priority={todo.priority} />
            </div>

            {/* Optional Description */}
            {todo.description && (
              <p
                className={`mt-0.5 text-xs line-clamp-1 min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${
                  isCompleted ? 'text-app-muted/70 line-through' : 'text-app-muted'
                }`}
              >
                {todo.description}
              </p>
            )}

            {/* Date & Time Row */}
            {(todo.scheduledDate || todo.dueTime) && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-app-muted min-w-0 max-w-full">
                {todo.scheduledDate && (
                  <span className="inline-flex shrink-0 items-center gap-1">
                    <Icon name="history" className="size-3 text-app-muted" />
                    <span>{todo.scheduledDate}</span>
                  </span>
                )}
                {todo.dueTime && (
                  <span className="inline-flex shrink-0 items-center gap-1">
                    <span>Due {todo.dueTime.slice(0, 5)}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex shrink-0 items-center gap-1.5 self-center">
          <button
            type="button"
            disabled={isMutating}
            onClick={() => onEdit(todo)}
            className="shrink-0 rounded-md border border-app-border px-2 py-1 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent disabled:opacity-50 transition"
            aria-label={'Edit todo: ' + todo.title}
          >
            Edit
          </button>

          <button
            type="button"
            disabled={isMutating}
            onClick={() => onDelete(todo.id)}
            className="shrink-0 rounded-md border border-[#d86b6b]/40 px-2 py-1 text-xs font-semibold text-app-danger hover:bg-[#d86b6b]/10 disabled:opacity-50 transition"
            aria-label={'Delete todo: ' + todo.title}
          >
            Delete
          </button>
        </div>
      </div>
    </Card>
  );
}
