import { describe, expect, it } from 'vitest';
import { planModuleChanges } from './plan.js';
import { PlatformValidationError } from '../errors.js';

// A slice of the real catalogue: core modules, a dependency chain
// (live-status → attendance → shifts) and cross-group dependents of clients.
const modules = [
  { id: 'id-identity', key: 'identity', name: 'Identity', isCore: true },
  { id: 'id-chat', key: 'chat', name: 'Chat', isCore: true },
  { id: 'id-tasks', key: 'tasks', name: 'Tasks', isCore: true },
  { id: 'id-shifts', key: 'shifts', name: 'Shifts', isCore: false },
  { id: 'id-attendance', key: 'attendance', name: 'Attendance', isCore: false },
  { id: 'id-live', key: 'live-status', name: 'Live Status', isCore: false },
  { id: 'id-clients', key: 'clients', name: 'Clients', isCore: false },
  { id: 'id-social', key: 'social', name: 'Manage Social Media', isCore: false },
  { id: 'id-deals', key: 'deals', name: 'Deals', isCore: false },
  { id: 'id-seo', key: 'seo-intelligence', name: 'SEO Intelligence', isCore: false },
  { id: 'id-projects', key: 'projects', name: 'Projects', isCore: false },
];
const edge = (from: string, to: string) => ({ moduleId: `id-${from}`, dependsOnModuleId: `id-${to}` });
const edges = [
  edge('attendance', 'shifts'),
  edge('live', 'attendance'),
  edge('social', 'clients'),
  edge('deals', 'clients'),
  edge('seo', 'clients'),
  edge('seo', 'projects'),
  edge('tasks', 'projects'),
];
const on = (...keys: string[]) => keys.map((key) => ({ key, status: 'enabled' }));
const off = (...keys: string[]) => keys.map((key) => ({ key, status: 'disabled' }));

function plan(current: { key: string; status: string }[], enable: string[], disable: string[] = []) {
  return planModuleChanges({ modules, edges, current, enable, disable });
}

describe('planModuleChanges', () => {
  it('enables a module that was gated with no switch, with its dependencies and core', () => {
    const result = plan(on('identity'), ['seo-intelligence']);
    expect(result.newlyEnabled).toEqual(['chat', 'clients', 'projects', 'seo-intelligence', 'tasks']); // projects via seo, not via tasks
    expect([...result.enableClosure]).toEqual(expect.arrayContaining(['identity', 'clients', 'projects']));
    expect(result.newlyDisabled).toEqual([]);
  });

  it('follows dependency chains transitively', () => {
    expect(plan(on('identity', 'chat', 'tasks'), ['live-status']).newlyEnabled).toEqual([
      'attendance', 'live-status', 'shifts',
    ]);
  });

  it('re-enables a previously disabled module', () => {
    const result = plan([...on('identity', 'chat', 'tasks', 'clients', 'projects'), ...off('social')], ['social']);
    expect(result.newlyEnabled).toEqual(['social']);
  });

  it("does not follow or enforce a core module's own dependencies", () => {
    // tasks is core and (in the catalogue) depends on projects.
    expect(plan(on('identity'), ['social']).newlyEnabled).not.toContain('projects');
    expect(plan(on('identity', 'chat', 'tasks', 'projects'), [], ['projects']).newlyDisabled).toEqual(['projects']);
  });

  it('refuses to disable a core module', () => {
    expect(() => plan(on('identity', 'tasks'), [], ['tasks'])).toThrow(/Tasks is always on/);
  });

  it('refuses to disable a module a remaining module depends on, naming the dependents', () => {
    const current = on('identity', 'clients', 'social', 'deals');
    expect(() => plan(current, [], ['clients'])).toThrow(PlatformValidationError);
    expect(() => plan(current, [], ['clients'])).toThrow(
      'Clients is needed by Deals, Manage Social Media. Disable those modules as well, or keep this one on.',
    );
  });

  it('allows disabling a module together with its dependents in one change', () => {
    const result = plan(on('identity', 'clients', 'social', 'deals'), [], ['clients', 'social', 'deals']);
    expect(result.newlyDisabled).toEqual(['clients', 'deals', 'social']);
    expect(result.newlyEnabled).toEqual([]);
    expect(result.enableClosure.size).toBe(0);
  });

  it('refuses to enable a module while disabling what it needs', () => {
    expect(() => plan(on('identity', 'clients'), ['social'], ['clients'])).toThrow(/Clients is needed by Manage Social Media/);
  });

  it('does not block edits on a company that is already inconsistent', () => {
    // social is on while clients is off (legacy state); disabling deals is unrelated.
    const current = [...on('identity', 'social', 'deals'), ...off('clients')];
    expect(plan(current, [], ['deals']).newlyDisabled).toEqual(['deals']);
  });

  it('records a disable for a module that never had a row', () => {
    const result = plan(on('identity'), [], ['social']);
    expect(result.newlyDisabled).toEqual([]);
    expect(result.disableRows).toEqual(['social']);
  });

  it('rejects unknown or inactive modules', () => {
    expect(() => plan(on('identity'), ['made-up'])).toThrow(/Unknown or inactive modules: made-up/);
  });

  it('rejects enabling a module whose dependency is inactive', () => {
    expect(() =>
      planModuleChanges({
        modules,
        edges: [...edges, { moduleId: 'id-social', dependsOnModuleId: 'id-retired' }],
        current: on('identity'),
        enable: ['social'],
        disable: [],
      }),
    ).toThrow(/unavailable dependency/);
  });
});
