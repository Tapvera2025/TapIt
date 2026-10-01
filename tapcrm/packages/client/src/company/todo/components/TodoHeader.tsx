import { Button } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';

export interface TodoHeaderProps {
  readonly onAddTodo: () => void;
}

export function TodoHeader({
  onAddTodo,
}: TodoHeaderProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">
          PERSONAL PLANNING
        </p>
        <h1 className="mt-0.5 font-display text-xl font-bold tracking-tight text-app-foreground sm:text-2xl">
          My Todo
        </h1>
        <p className="mt-0.5 text-xs sm:text-sm text-app-muted">
          Your personal Todo workspace for planning, organizing, and tracking tasks.
        </p>
      </div>

      <div className="flex items-center gap-2.5 sm:self-center">
        <Button
          type="button"
          kind="primary"
          onClick={onAddTodo}
          className="inline-flex h-9 items-center gap-2 px-3.5 text-xs font-semibold sm:text-sm shadow-xs"
          aria-label="Add new todo"
        >
          <Icon name="todo" className="size-4 stroke-[2]" />
          <span>Add Todo</span>
        </Button>
      </div>
    </div>
  );
}
