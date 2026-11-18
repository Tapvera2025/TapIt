import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspace, WORKSPACE_ACTIVATION_MS } from './workspaceActivation.js';

function scene({ hidden = false, reduced = false } = {}) {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    matchMedia: () => ({ matches: reduced }),
  });
  const classes = new Set<string>();
  const element = {
    getClientRects: () => (hidden ? [] : [{}]),
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
  } as unknown as HTMLElement;
  return { element, classes };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('workspace activation navigation gate', () => {
  it('finishes within 650ms even when animationend never fires', async () => {
    const { element, classes } = scene();
    const completed = vi.fn();
    const activation = activateWorkspace(element).then(completed);
    expect(classes.has('is-activating')).toBe(true);
    await vi.advanceTimersByTimeAsync(WORKSPACE_ACTIVATION_MS - 1);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await activation;
    expect(completed).toHaveBeenCalledTimes(1);
    expect(classes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ hidden: true }, { reduced: true }])(
    'skips invisible or reduced-motion animation: %j',
    async (options) => {
      const { element, classes } = scene(options);
      await activateWorkspace(element);
      expect(classes.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('continues immediately if the illustration is unavailable', async () => {
    scene();
    await activateWorkspace(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up on unmount and resolves once without a late timer', async () => {
    const { element, classes } = scene();
    const controller = new AbortController();
    const completed = vi.fn();
    const activation = activateWorkspace(element, controller.signal).then(completed);
    controller.abort();
    await activation;
    expect(classes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(WORKSPACE_ACTIVATION_MS);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it('does not animate an already abandoned login screen', async () => {
    const { element, classes } = scene();
    const controller = new AbortController();
    controller.abort();
    await activateWorkspace(element, controller.signal);
    expect(classes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
