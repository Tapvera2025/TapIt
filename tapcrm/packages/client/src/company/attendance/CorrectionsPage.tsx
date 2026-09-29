export function CorrectionsPage(): React.JSX.Element {
  return (
    <div className="p-4 sm:p-6">
      <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center">
        <p className="text-sm font-semibold text-app-foreground">Correction Queue</p>
        <p className="mt-2 text-sm text-app-muted">
          The scoped correction review list (G8) is not yet available. Corrections can be
          requested from the attendance day detail view, and decisions will appear here once
          the queue endpoint is registered.
        </p>
      </div>
    </div>
  );
}
