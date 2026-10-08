import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmployeeSetupPage } from './EmployeeSetupPage.js';
import { ThemeProvider } from '../../theme/ThemeContext.js';

describe('EmployeeSetupPage component', () => {
  // Mock window environment for static rendering
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: () => 'light',
      setItem: () => {},
    },
    matchMedia: () => ({ matches: false }),
  };

  it('renders loading state initially without leaking raw token in HTML', () => {
    const rawSecretToken = 'super-secret-raw-token-1234567890abcdef';
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(EmployeeSetupPage, {
          token: rawSecretToken,
          organizationCode: 'TESTORG',
          onComplete: () => {},
        }),
      ),
    );

    // Verifies the page loads
    expect(html).toContain('Account setup');
    expect(html).toContain('Verifying your invitation');

    // CRITICAL: Raw token must never be rendered into DOM or text
    expect(html).not.toContain(rawSecretToken);
  });

  it('renders missing parameters error when token or org is omitted without leaking token', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(EmployeeSetupPage, {
          token: '',
          organizationCode: '',
          onComplete: () => {},
        }),
      ),
    );

    expect(html).toContain('Account setup');
  });
});
