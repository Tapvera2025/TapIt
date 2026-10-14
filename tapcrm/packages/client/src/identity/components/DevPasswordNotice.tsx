import { useEffect, useRef, useState } from 'react';
import type { DevPasswordReset } from '../api/authApi.js';

/**
 * DEVELOPMENT ONLY. The new company admin password from
 * DEV_INSTANT_PASSWORD_RESET, shown on the login page above the filled-in form.
 */
export function DevPasswordNotice({ reset }: { reset: DevPasswordReset }) {
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const valueRef = useRef<HTMLElement>(null);

  // A new password: say so to screen readers and put the keyboard next to Copy.
  useEffect(() => {
    setCopied(false);
    panelRef.current?.focus();
  }, [reset.password]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reset.password);
      setCopied(true);
    } catch {
      // Clipboard blocked: select the password so Ctrl/Cmd+C copies it.
      const node = valueRef.current;
      const selection = window.getSelection();
      if (!node || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby="dev-password-title"
      className="mt-6 rounded-[14px] border border-app-accent/30 bg-app-accent/10 p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-app-accent/25"
    >
      <h2 id="dev-password-title" className="text-[11px] font-bold uppercase tracking-[0.15em] text-app-accent">New password</h2>
      <p className="mt-1.5 text-sm leading-6 text-app-muted">
        For <strong className="break-all font-semibold text-app-foreground">{reset.email}</strong>. It is filled in below, so you can sign in now.
      </p>
      <div className="mt-3 flex items-stretch gap-2">
        <code
          ref={valueRef}
          aria-label="New password"
          className="min-w-0 flex-1 select-all break-all rounded-[10px] border border-app-border bg-app-background px-3 py-2.5 font-mono text-[15px] font-semibold tracking-[0.02em] text-app-foreground"
        >
          {reset.password}
        </code>
        <button
          type="button"
          onClick={() => { void copy(); }}
          className="shrink-0 rounded-[10px] border border-app-border bg-app-surface px-3.5 text-xs font-bold text-app-foreground transition hover:border-app-accent hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-3 text-xs leading-5 text-app-muted">
        Development only (DEV_INSTANT_PASSWORD_RESET is on). The old password no longer works and this account was signed out everywhere else.
      </p>
    </section>
  );
}
