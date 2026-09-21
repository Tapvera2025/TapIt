export {
  Page,
  Card,
  Button,
  Field,
  Select,
  Notice,
  Loading,
  Empty,
  Modal,
  ErrorMessage,
} from '../../ui/components.js';

interface TreePosition {
  id: string;
  name: string;
  code: string;
  organizationalLevel: number;
  holderCount?: number;
  status: string;
  children?: TreePosition[];
}

export function PositionTree({
  nodes,
  onSelect,
}: {
  nodes: TreePosition[];
  onSelect?: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      {nodes.map((node) => (
        <div key={node.id} className="border-l border-app-border pl-4">
          <button
            type="button"
            onClick={() => onSelect?.(node.id)}
            className="w-full rounded-lg p-3 text-left hover:bg-app-background"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{node.name}</span>
              <span className="text-xs text-app-muted">
                L{node.organizationalLevel} · {node.holderCount ?? 0} holder
                {node.holderCount === 1 ? '' : 's'} · {node.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-app-muted">{node.code}</p>
          </button>
          {node.children && node.children.length > 0 && (
            <div className="mt-2 space-y-2">
              <PositionTree nodes={node.children} {...(onSelect ? { onSelect } : {})} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
