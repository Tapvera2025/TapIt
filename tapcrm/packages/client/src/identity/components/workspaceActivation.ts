/** Keep this in sync with the 650ms CSS activation timeline. */
export const WORKSPACE_ACTIVATION_MS = 650;

export function activateWorkspace(
  element: HTMLElement | null,
  signal?: AbortSignal,
): Promise<void> {
  if (
    signal?.aborted ||
    !element ||
    element.getClientRects().length === 0 ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
    return Promise.resolve();

  return new Promise((resolve) => {
    // The bounded timer deliberately does not depend on animationend: removed
    // styles, interrupted animations and resize cannot strand a signed-in user.
    const finish = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      element.classList.remove('is-activating');
      resolve();
    };
    const timer = window.setTimeout(finish, WORKSPACE_ACTIVATION_MS);
    signal?.addEventListener('abort', finish, { once: true });
    element.classList.add('is-activating');
  });
}
