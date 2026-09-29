export function BiometricPage(): React.JSX.Element {
  return (
    <div className="p-4 sm:p-6">
      <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center">
        <p className="text-sm font-semibold text-app-foreground">Biometric Devices</p>
        <p className="mt-2 text-sm text-app-muted">
          Biometric device management and punch log review will be available in an upcoming release.
        </p>
      </div>
    </div>
  );
}
