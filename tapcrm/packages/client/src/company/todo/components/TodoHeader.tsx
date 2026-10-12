import { Button } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';

export interface TodoHeaderProps {
  readonly onAddTodo: () => void;
}

export function TodoHeader({ onAddTodo }: TodoHeaderProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">
          PERSONAL PLANNING
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-app-foreground sm:text-3xl">
          My Todo
        </h1>
        <p className="mt-1 text-xs text-app-muted sm:text-sm">
          Plan your day, organize upcoming work, and stay on track.
        </p>
        <span className="sr-only">Your personal Todo workspace</span>
      </div>

      <div className="flex items-center gap-2.5 sm:self-center">
        <Button
          type="button"
          kind="primary"
          onClick={onAddTodo}
          className="inline-flex h-10 items-center gap-2 px-4 text-xs font-semibold shadow-xs sm:text-sm"
          aria-label="Add new todo"
        >
          <Icon name="todo" className="size-4 stroke-[2]" />
          <span>Add Todo</span>
        </Button>
      </div>
    </div>
  );
}
