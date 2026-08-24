import { MODULES, MODULE_PHASE, ACTIONS } from '@tapcrm/contracts';

/**
 * Scaffold shell.
 *
 * Deliberately minimal: UI.md ("Screen specifications and interaction detail")
 * is listed in PRD.md §0 as *to be written*, so inventing screens now would
 * mean throwing them away. What this proves is the part that matters
 * structurally — the client imports the SAME generated registry the server
 * does, so a renamed action breaks both at compile time (NF-21).
 */
export function App(): React.JSX.Element {
  const byPhase = new Map<number, string[]>();
  for (const module of MODULES) {
    const phase = MODULE_PHASE[module];
    byPhase.set(phase, [...(byPhase.get(phase) ?? []), module]);
  }

  return (
    <main style={{ fontFamily: 'ui-sans-serif, system-ui', padding: '2rem', maxWidth: 900 }}>
      <h1 style={{ marginBottom: '0.25rem' }}>TapCRM</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        {MODULES.length} modules · {ACTIONS.length} actions in the registry
      </p>
      {[...byPhase.entries()]
        .sort(([a], [b]) => a - b)
        .map(([phase, modules]) => (
          <section key={phase}>
            <h2 style={{ fontSize: '1rem' }}>P{phase}</h2>
            <p style={{ color: '#444', marginTop: 0 }}>{modules.join(' · ')}</p>
          </section>
        ))}
    </main>
  );
}
