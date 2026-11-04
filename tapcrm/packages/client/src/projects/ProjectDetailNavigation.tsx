import { Button } from '../ui/components.js';

type ProjectDetailTab = {
  value: string;
  label: string;
  shortLabel?: string;
};

export function ProjectDetailNavigation({
  projectName,
  businessName,
  onBack,
  onAction,
  actionLabel = 'Edit project',
  tabs,
  value,
  onChange,
}: {
  projectName: string;
  businessName: string;
  onBack: () => void;
  onAction?: () => void;
  actionLabel?: string;
  tabs: readonly ProjectDetailTab[];
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-app-border px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <button type="button" onClick={onBack} className="shrink-0 text-xs font-semibold text-app-muted hover:text-app-accent">← Back</button>
          <h1 className="truncate font-display text-base font-bold">{projectName}</h1>
          <p className="shrink-0 text-xs text-app-muted">{businessName}</p>
        </div>
        {onAction && <Button kind="secondary" onClick={onAction} className="!shrink-0 !px-3 !py-1.5 !text-xs">{actionLabel}</Button>}
      </div>
      <div className="project-detail-navigation-tabs flex shrink-0 gap-1 overflow-x-auto border-b border-app-border px-4 py-1.5 scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-selected={value === tab.value}
            onClick={() => onChange(tab.value)}
            className="project-detail-navigation-tab min-w-0 flex-1 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold sm:text-sm"
          >
            {tab.shortLabel ? <><span className="sm:hidden">{tab.shortLabel}</span><span className="hidden sm:inline">{tab.label}</span></> : tab.label}
          </button>
        ))}
      </div>
    </>
  );
}
