import { useEffect, useRef } from 'react';
import { LoginForm } from '../components/LoginForm.js';
import {
  WorkspaceIllustration,
  LoginWaves,
} from '../components/WorkspaceIllustration.js';
import { activateWorkspace } from '../components/workspaceActivation.js';
import type { DevPasswordReset, IdentityLoginResult } from '../api/authApi.js';
import './login.css';

export function IdentityLoginPage({
  onSuccess,
  onForgotPassword,
  devReset = null,
}: {
  onSuccess: (result: IdentityLoginResult) => void;
  onForgotPassword: (email: string) => void;
  devReset?: DevPasswordReset | null;
}) {
  const illustration = useRef<HTMLDivElement>(null);
  const lifecycle = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => controller.abort();
  }, []);

  async function handleSuccess(result: IdentityLoginResult) {
    const signal = lifecycle.current?.signal;
    // Tokens are already saved by identityLogin. Only the existing navigation
    // callback waits; validation, requests and session handling stay unchanged.
    try {
      await activateWorkspace(illustration.current, signal);
    } finally {
      // Decorative effects must never block an authenticated session.
      if (!signal?.aborted) onSuccess(result);
    }
  }

  return (
    <main className="workspace-login">
      <LoginWaves />
      <div className="workspace-login-layout">
        <section className="workspace-login-hero" aria-label="Your connected workspace">
          <h2>
            One workspace
            <br />
            for your business
          </h2>
          <svg
            className="workspace-login-underline"
            viewBox="0 0 300 25"
            fill="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="login-underline">
                <stop stopColor="#ffb538" />
                <stop offset=".5" stopColor="#ff7100" />
                <stop offset="1" stopColor="#ffc0a0" />
              </linearGradient>
            </defs>
            <path
              d="M5 19Q147 -7 294 17"
              stroke="url(#login-underline)"
              strokeWidth="7"
              strokeLinecap="round"
            />
          </svg>
          <WorkspaceIllustration ref={illustration} />
        </section>
        <LoginForm
          variant="workspace"
          onSuccess={handleSuccess}
          onForgotPassword={onForgotPassword}
          devReset={devReset}
        />
      </div>
    </main>
  );
}
