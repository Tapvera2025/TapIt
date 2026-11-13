import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Button, Icon } from '../../../ui/index.js';
import type { GuideAction, GuideCommand, GuideStep, GuideTone, Guidance } from './guidance.js';
import { guideForPath, salesGuideKey, type SalesPageViewer } from './page-guidance.js';

/**
 * The sales guide ("coach"): a panel beside every Sales page that says what
 * to do next. Docked on wide screens; a small pill elsewhere that opens a
 * sheet. People can minimize it to the pill or close it; the compass button
 * in the top bar brings it back. The choice is remembered per person on
 * this device.
 */

export type GuideMode = 'open' | 'minimized' | 'closed';

interface SalesGuideContextValue {
  readonly mode: GuideMode;
  readonly setMode: (mode: GuideMode) => void;
  readonly viewer: SalesPageViewer;
  readonly dock: HTMLElement | null;
  readonly setDock: (element: HTMLElement | null) => void;
  /** Coaches a page rendered itself; while any is mounted the page default stays hidden. */
  readonly pageCoaches: number;
  readonly registerPageCoach: () => () => void;
}

const SalesGuideContext = createContext<SalesGuideContextValue | null>(null);

const STORAGE_PREFIX = 'tapcrm.salesGuide.v1.';
const WIDE_SCREEN = '(min-width: 1280px)';

function readMode(userId: string): GuideMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + userId);
    return stored === 'minimized' || stored === 'closed' ? stored : 'open';
  } catch {
    return 'open';
  }
}

function writeMode(userId: string, mode: GuideMode): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, mode);
  } catch {
    // Storage can be unavailable (private windows); the choice then lasts for this visit.
  }
}

export function SalesGuideProvider({ userId, isManager, canAddLeads, canRecordWin, canDecideApprovals, children }: SalesPageViewer & { userId: string; children: ReactNode }): React.JSX.Element {
  const viewer = useMemo<SalesPageViewer>(
    () => ({ isManager, canAddLeads, canRecordWin, canDecideApprovals }),
    [isManager, canAddLeads, canRecordWin, canDecideApprovals],
  );
  const [mode, setModeState] = useState<GuideMode>(() => readMode(userId));
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const [pageCoaches, setPageCoaches] = useState(0);
  const setMode = useCallback((next: GuideMode) => {
    setModeState(next);
    writeMode(userId, next);
  }, [userId]);
  const registerPageCoach = useCallback(() => {
    setPageCoaches((count) => count + 1);
    return () => setPageCoaches((count) => count - 1);
  }, []);
  const value = useMemo<SalesGuideContextValue>(
    () => ({ mode, setMode, viewer, dock, setDock, pageCoaches, registerPageCoach }),
    [mode, setMode, viewer, dock, pageCoaches, registerPageCoach],
  );
  return <SalesGuideContext.Provider value={value}>{children}</SalesGuideContext.Provider>;
}

export function useSalesGuide(): SalesGuideContextValue | null {
  return useContext(SalesGuideContext);
}

/**
 * Lays a Sales page out beside the docked guide and shows the page's
 * default guide until the page renders one of its own.
 */
export function SalesGuideFrame({ pathname, onNavigate, children }: { pathname: string; onNavigate: (path: string) => void; children: ReactNode }): React.JSX.Element {
  const guide = useSalesGuide();
  const key = salesGuideKey(pathname);
  if (!guide || key === null) return <>{children}</>;
  const docked = guide.mode === 'open';
  return (
    <div className={docked ? 'xl:flex xl:items-start' : undefined}>
      <div className="min-w-0 flex-1">{children}</div>
      <aside
        ref={guide.setDock}
        aria-label="Sales guide"
        className={docked ? 'sales-guide-dock hidden xl:sticky xl:top-0 xl:block xl:w-[21rem] xl:shrink-0 xl:pr-8' : 'hidden'}
      />
      {guide.pageCoaches === 0 && <CoachView guidance={guideForPath(key, guide.viewer)} onNavigate={onNavigate} />}
    </div>
  );
}

/** The compass button in the top bar: shows or hides the guide on Sales pages. */
export function SalesGuideToggle(): React.JSX.Element | null {
  const guide = useSalesGuide();
  if (!guide) return null;
  const on = guide.mode !== 'closed';
  return (
    <button
      type="button"
      onClick={() => guide.setMode(on ? 'closed' : 'open')}
      className={`navbar-action-button inline-flex size-9 shrink-0 items-center justify-center rounded-xl border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
        on ? 'border-app-accent/40 bg-app-accent/10 text-app-accent' : 'border-app-border bg-app-surface-raised text-app-muted hover:border-app-accent/50 hover:text-app-accent'
      }`}
      aria-pressed={on}
      aria-label={on ? 'Hide the sales guide' : 'Show the sales guide'}
      title={on ? 'Hide the sales guide' : 'Show the sales guide'}
    >
      <Icon name="compass" className="size-4" />
    </button>
  );
}

/**
 * A page's own guide (a lead, a deal, My Work…). `onCommand` runs the work
 * the guide's buttons ask for; the page owns those API calls and dialogs.
 */
export function SalesCoach({ guidance, onCommand, onNavigate }: { guidance: Guidance | null; onCommand?: (command: GuideCommand) => Promise<void> | void; onNavigate: (path: string) => void }): React.JSX.Element | null {
  const guide = useSalesGuide();
  const register = guide?.registerPageCoach;
  useEffect(() => register?.(), [register]);
  if (!guide) return null;
  return <CoachView guidance={guidance ?? WORKING_IT_OUT} onCommand={onCommand} onNavigate={onNavigate} />;
}

const WORKING_IT_OUT: Guidance = { context: 'Sales', tone: 'info', title: 'Working out the next step…', detail: 'One moment.', actions: [] };

const TONES: Record<GuideTone, { label: string; dot: string; chip: string; edge: string }> = {
  act: { label: 'Next step', dot: 'bg-app-accent', chip: 'bg-app-accent/12 text-app-accent', edge: 'border-t-app-accent' },
  wait: { label: 'Waiting', dot: 'bg-amber-500', chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', edge: 'border-t-amber-500' },
  done: { label: 'Done', dot: 'bg-emerald-500', chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', edge: 'border-t-emerald-500' },
  blocked: { label: 'Needs attention', dot: 'bg-[#d86b6b]', chip: 'bg-[#d86b6b]/15 text-app-danger', edge: 'border-t-[#d86b6b]' },
  info: { label: 'Good to know', dot: 'bg-sky-500', chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', edge: 'border-t-sky-500' },
};

const PILL_PREFIX: Record<GuideTone, string> = { act: 'Next', wait: 'Waiting', done: 'Done', blocked: 'Blocked', info: 'Guide' };

function CoachView({ guidance, onCommand, onNavigate }: { guidance: Guidance; onCommand?: ((command: GuideCommand) => Promise<void> | void) | undefined; onNavigate: (path: string) => void }): React.JSX.Element | null {
  const guide = useSalesGuide();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    if (!sheetOpen) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSheetOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  if (!guide || guide.mode === 'closed') return null;
  const { mode, setMode, dock } = guide;

  const perform = async (action: GuideAction): Promise<void> => {
    setError(null);
    switch (action.do.kind) {
      case 'navigate':
        setSheetOpen(false);
        onNavigate(action.do.to);
        return;
      case 'focus':
        setSheetOpen(false);
        focusGuideTarget(action.do.target);
        return;
      case 'link':
        return;
      case 'command': {
        if (!onCommand) return;
        setBusy(true);
        try {
          await onCommand(action.do.command);
          setSheetOpen(false);
        } catch (cause) {
          setError({ title: guidance.title, message: cause instanceof Error ? cause.message : 'That did not work. Try again.' });
        } finally {
          setBusy(false);
        }
        return;
      }
      default:
        return;
    }
  };

  const close = (): void => {
    setSheetOpen(false);
    setMode('closed');
    toast('Guide hidden. The compass button at the top brings it back.', { id: 'sales-guide-hidden' });
  };
  // An error belongs to the step it came from; a new step clears it.
  const shownError = error && error.title === guidance.title ? error.message : null;
  const card = (variant: 'docked' | 'sheet') => (
    <CoachCard
      guidance={guidance}
      busy={busy}
      error={shownError}
      variant={variant}
      onAction={(action) => void perform(action)}
      onMinimize={variant === 'docked' ? () => setMode('minimized') : () => setSheetOpen(false)}
      onClose={close}
    />
  );

  const expand = (): void => {
    if (window.matchMedia(WIDE_SCREEN).matches) setMode('open');
    else setSheetOpen(true);
  };
  const tone = TONES[guidance.tone];

  return (
    <>
      {mode === 'open' && dock && createPortal(card('docked'), dock)}
      {!sheetOpen && createPortal(
        <button
          type="button"
          onClick={expand}
          className={`sales-guide-pill fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-app-border bg-app-surface px-3.5 py-2 text-left text-sm text-app-foreground shadow-lg transition hover:border-app-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent xl:bottom-6 xl:right-6 sm:max-w-sm ${mode === 'open' ? 'xl:hidden' : ''}`}
          aria-label={`Open the sales guide. ${PILL_PREFIX[guidance.tone]}: ${guidance.short ?? guidance.title}`}
        >
          <Icon name="compass" className="size-4 shrink-0 text-app-accent" />
          <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
          <span className="truncate">
            <span className="font-semibold">{PILL_PREFIX[guidance.tone]}:</span> {guidance.short ?? guidance.title}
          </span>
          <Icon name="chevron-up" className="size-3.5 shrink-0 text-app-muted" />
        </button>,
        document.body,
      )}
      {sheetOpen && createPortal(
        <div className="fixed inset-0 z-[45] flex items-end bg-black/30 xl:hidden" onClick={() => setSheetOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sales guide"
            className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-app-background p-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            {card('sheet')}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function CoachCard({ guidance, busy, error, variant, onAction, onMinimize, onClose }: {
  guidance: Guidance;
  busy: boolean;
  error: string | null;
  variant: 'docked' | 'sheet';
  onAction: (action: GuideAction) => void;
  onMinimize: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const tone = TONES[guidance.tone];
  const primaryActions = guidance.actions.filter((action) => action.emphasis === 'primary');
  const others = guidance.actions.filter((action) => action.emphasis === 'secondary');
  const dangers = guidance.actions.filter((action) => action.emphasis === 'danger');
  return (
    <section
      className={`sales-guide-card ui-card overflow-hidden border-t-4 p-0 ${tone.edge} ${variant === 'docked' ? 'max-h-[calc(100dvh-7.5rem)] overflow-y-auto' : ''}`}
    >
      <header className="flex items-center gap-2 border-b border-app-border px-4 py-2.5">
        <Icon name="compass" className="size-4 text-app-accent" />
        <p className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-[0.12em] text-app-muted">
          Guide · <span className="normal-case tracking-normal">{guidance.context}</span>
        </p>
        <button type="button" onClick={onMinimize} className="rounded-lg p-1.5 text-app-muted hover:bg-app-background hover:text-app-foreground" aria-label={variant === 'docked' ? 'Minimize the guide' : 'Hide the guide'} title={variant === 'docked' ? 'Minimize' : 'Hide'}>
          <Icon name={variant === 'docked' ? 'minus' : 'chevron-down'} className="size-4" />
        </button>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-app-muted hover:bg-app-background hover:text-app-foreground" aria-label="Close the guide" title="Close the guide">
          <Icon name="close" className="size-4" />
        </button>
      </header>

      <div className="space-y-4 px-4 py-4">
        {/* Announced when the next step changes (e.g. after pressing its button). */}
        <div aria-live="polite">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone.chip}`}>{tone.label}</span>
            {guidance.badge && <span className="rounded-full bg-app-background px-2 py-0.5 text-[11px] font-bold text-app-foreground ring-1 ring-inset ring-app-border">{guidance.badge}</span>}
          </div>
          <h2 className="mt-2 font-display text-lg font-bold leading-snug">{guidance.title}</h2>
          {guidance.detail && <p className="mt-1.5 text-sm leading-6 text-app-muted">{guidance.detail}</p>}
        </div>

        {error && <p className="rounded-lg bg-[#d86b6b]/10 p-2.5 text-xs text-app-danger" role="alert">{error}</p>}

        {(primaryActions.length > 0 || others.length > 0 || dangers.length > 0) && (
          <div className="space-y-2">
            {primaryActions.map((action) => <GuideButton key={action.label} action={action} busy={busy} onAction={onAction} wide />)}
            {others.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {others.map((action) => <GuideButton key={action.label} action={action} busy={busy} onAction={onAction} />)}
              </div>
            )}
            {dangers.map((action) => (
              <button key={action.label} type="button" disabled={busy} onClick={() => onAction(action)} className="text-xs font-semibold text-app-danger underline-offset-2 hover:underline disabled:opacity-50">
                {action.label}
              </button>
            ))}
          </div>
        )}

        {guidance.waitingOn && (
          <p className="flex items-center gap-2 rounded-lg bg-app-background px-3 py-2 text-xs">
            <Icon name="users" className="size-3.5 shrink-0 text-app-muted" />
            <span className="text-app-muted">Whose move:</span>
            <span className="min-w-0 truncate font-semibold">{guidance.waitingOn}</span>
          </p>
        )}

        {guidance.steps && guidance.steps.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-app-muted">
              {guidance.stepsKind === 'map' ? 'Where this page fits' : 'Progress'}
            </p>
            <StepList steps={guidance.steps} kind={guidance.stepsKind ?? 'progress'} />
          </div>
        )}

        {guidance.tips && guidance.tips.length > 0 && (
          <ul className="space-y-1.5 border-t border-app-border pt-3">
            {guidance.tips.map((tip) => (
              <li key={tip} className="flex gap-2 text-xs leading-5 text-app-muted">
                <Icon name="lightbulb" className="mt-0.5 size-3.5 shrink-0 text-app-accent" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function GuideButton({ action, busy, onAction, wide = false }: { action: GuideAction; busy: boolean; onAction: (action: GuideAction) => void; wide?: boolean }): React.JSX.Element {
  const size = wide ? 'w-full justify-center' : 'px-3 py-2 text-xs';
  if (action.do.kind === 'link') {
    const primaryStyle = action.emphasis === 'primary';
    return (
      <a
        href={action.do.href}
        className={`ui-button inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-bold transition ${primaryStyle ? 'ui-primary' : 'border-app-border text-app-foreground hover:border-app-accent'} ${size}`}
      >
        <Icon name={action.do.href.startsWith('tel:') ? 'phone' : 'message'} className="size-3.5" />
        {action.label}
      </a>
    );
  }
  return (
    <Button kind={action.emphasis === 'primary' ? 'primary' : 'secondary'} disabled={busy} onClick={() => onAction(action)} className={`inline-flex items-center gap-1.5 ${size}`}>
      {action.label}
    </Button>
  );
}

const STATE_WORDS: Record<GuideStep['state'], string> = { done: 'done', current: 'in progress', upcoming: 'to do', skipped: 'not needed', lost: 'ended' };

export function StepIcon({ state }: { state: GuideStep['state'] }): React.JSX.Element {
  switch (state) {
    case 'done':
      return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"><Icon name="check" className="size-3" /></span>;
    case 'current':
      return <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-app-accent"><span className="size-2 rounded-full bg-app-accent" /></span>;
    case 'skipped':
      return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-app-background text-app-muted"><Icon name="minus" className="size-3" /></span>;
    case 'lost':
      return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#d86b6b]/15 text-app-danger"><Icon name="close" className="size-3" /></span>;
    default:
      return <span className="size-5 shrink-0 rounded-full border-2 border-app-border" />;
  }
}

function StepList({ steps, kind }: { steps: readonly GuideStep[]; kind: 'progress' | 'map' }): React.JSX.Element {
  return (
    <ol className="space-y-1.5">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2.5 text-sm">
          <StepIcon state={step.state} />
          <span className={step.state === 'current' ? 'font-semibold text-app-foreground' : step.state === 'done' ? 'text-app-foreground' : 'text-app-muted'}>
            {step.label}
          </span>
          <span className="sr-only">({kind === 'map' && step.state === 'current' ? 'this page' : STATE_WORDS[step.state]})</span>
          {kind === 'map' && step.state === 'current' && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-app-accent" aria-hidden="true">This page</span>}
        </li>
      ))}
    </ol>
  );
}

/** A lead's or deal's progress across the top of its page. */
export function StepTracker({ steps, label }: { steps: readonly GuideStep[]; label: string }): React.JSX.Element {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {steps.map((step, index) => (
          <li key={step.key} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true" className={`hidden h-px w-5 sm:block ${step.state === 'done' || step.state === 'current' ? 'bg-app-accent/50' : 'bg-app-border'}`} />}
            <StepIcon state={step.state} />
            <span className={`text-xs font-semibold ${step.state === 'current' ? 'text-app-foreground' : step.state === 'done' ? 'text-app-foreground/80' : 'text-app-muted'}`}>{step.label}</span>
            <span className="sr-only">({STATE_WORDS[step.state]})</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Scrolls to a panel on the page, outlines it briefly and puts the cursor in its first field. */
export function focusGuideTarget(id: string): void {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.remove('guide-flash');
  void element.offsetWidth;
  element.classList.add('guide-flash');
  window.setTimeout(() => element.classList.remove('guide-flash'), 1800);
  const field = element.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
  field?.focus({ preventScroll: true });
}
