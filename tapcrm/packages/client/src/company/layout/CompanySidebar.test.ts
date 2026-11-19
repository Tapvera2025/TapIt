import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanySidebar } from './CompanySidebar.js';
import { ThemeProvider } from '../../theme/ThemeContext.js';

describe('CompanySidebar - Recruitment Dropdown', () => {
  // Minimal window mock for ThemeContext in Node environment
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: () => 'dark',
      setItem: () => {},
    },
    matchMedia: () => ({ matches: false }),
  };

  const baseIdentity = {
    fullName: 'HR Manager',
    email: 'hr@example.com',
    accountType: 'employee',
    departmentCode: 'HR',
    departmentName: 'Human Resources',
    positionCode: 'HR-MGR',
  };

  it('renders Recruitment dropdown expanded when current route is /company/recruitment', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          pathname: '/company/recruitment',
          identity: baseIdentity,
          organizationName: 'Test Corp',
          accountType: 'employee',
          isHr: true,
          hasRecruitment: true,
          onNavigate: () => {},
          onLogout: () => {},
          open: true,
          onClose: () => {},
        })
      )
    );

    // The Recruitment group is open on a recruitment route and offers one way
    // in; its pages (Requisitions, Resume Inbox, ...) are tabs on the page.
    expect(html).toMatch(/aria-expanded="true"[^>]*>[\s\S]*?Recruitment/);
    expect(html).toMatch(/aria-current="page"[\s\S]*?Overview/);
    expect(html).not.toContain('Resume Inbox');
    expect(html).not.toContain('Requisitions');
  });

  it('keeps one sidebar entry for each module whose pages are tabs', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          pathname: '/company/dashboard',
          identity: { ...baseIdentity, accountType: 'super-admin' },
          organizationName: 'Test Corp',
          accountType: 'super-admin',
          isHr: true,
          hasRecruitment: true,
          onNavigate: () => {},
          onLogout: () => {},
          open: true,
          onClose: () => {},
        }),
      ),
    );
    for (const group of ['Recruitment', 'Identity &amp; Access']) expect(html).toContain(group);
    expect(html).toContain('Sessions &amp; Devices');
    expect(html).not.toContain('Access Explorer');
  });

  it('renders Recruitment dropdown collapsed when current route is outside recruitment', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          pathname: '/company/dashboard',
          identity: baseIdentity,
          organizationName: 'Test Corp',
          accountType: 'employee',
          isHr: true,
          hasRecruitment: true,
          onNavigate: () => {},
          onLogout: () => {},
          open: true,
          onClose: () => {},
        })
      )
    );

    // Dropdown button should have aria-expanded="false"
    expect(html).toContain('aria-expanded="false"');
    // Child items should NOT be present when collapsed
    expect(html).not.toContain('Resume Inbox');
    expect(html).not.toContain('Candidates');
  });

  it('renders Settings in the responsive sidebar without the appearance palette', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          // Employee sections stay folded except Overview and the one holding
          // the current page, so Settings shows when the person is on it.
          pathname: '/company/settings',
          identity: baseIdentity,
          organizationName: 'Test Corp',
          accountType: 'employee',
          onNavigate: () => {},
          onLogout: () => {},
          open: true,
          onClose: () => {},
        })
      )
    );

    // A group with a single entry is shown as that entry (a plain link), so the
    // old "Preferences" group label is no longer rendered; Settings itself is.
    expect(html).toContain('Settings');
    expect(html).not.toContain('aria-label="Color appearance themes"');
  });

  it('selects only the active nested Leads destination', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          pathname: '/company/sales/leads/re-engagement',
          identity: { ...baseIdentity, accountType: 'super-admin' },
          organizationName: 'Test Corp',
          accountType: 'super-admin',
          canViewLeads: true,
          canViewImports: true,
          onNavigate: () => {},
          onLogout: () => {},
          open: true,
          onClose: () => {},
        }),
      ),
    );

    expect(html).toMatch(/<button[^>]*aria-current="page"[^>]*>[\s\S]*?Follow-up Required/);
    expect(html).not.toMatch(/<button[^>]*aria-current="page"[^>]*>[\s\S]*?All Leads/);
  });

  it('places the active pill on My Work instead of the Sales overview ancestor', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          pathname: '/company/sales/my-work',
          identity: { ...baseIdentity, accountType: 'super-admin' },
          organizationName: 'Test Corp',
          accountType: 'super-admin',
          canViewLeads: true,
          onNavigate: () => {},
          onLogout: () => {},
          open: true,
          onClose: () => {},
        }),
      ),
    );

    expect(html).toMatch(/<button[^>]*aria-current="page"[^>]*>[\s\S]*?My Work/);
    expect(html).not.toMatch(/<button[^>]*aria-current="page"[^>]*>[\s\S]*?Overview/);
  });
});
