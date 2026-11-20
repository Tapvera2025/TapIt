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

  // Recruitment powers held by an HR position at department reach.
  const recruiter = [
    { action: 'recruitment:view-metrics', scope: 'department' },
    { action: 'recruitment:view-candidates', scope: 'department' },
  ];

  it('renders Recruitment dropdown expanded on /company/recruitment with only the tabs the position holds', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          pathname: '/company/recruitment',
          identity: baseIdentity,
          organizationName: 'Test Corp',
          accountType: 'employee',
          capabilities: recruiter,
          onNavigate: () => {},
          onLogout: () => {},
          open: true,
          onClose: () => {},
        })
      )
    );

    expect(html).toMatch(/aria-expanded="true"[^>]*>[\s\S]*?Recruitment/);
    expect(html).toMatch(/aria-current="page"[\s\S]*?Overview/);
    expect(html).toContain('Candidates');
    // Powers the position does not hold are not offered.
    expect(html).not.toContain('Resume Inbox');
    expect(html).not.toContain('Requisitions');
    expect(html).not.toContain('Offers');
  });

  it('shows nothing for a department name alone: an "HR" employee without powers gets no Recruitment', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CompanySidebar, {
          pathname: '/company/dashboard',
          identity: baseIdentity,
          organizationName: 'Test Corp',
          accountType: 'employee',
          capabilities: [],
          onNavigate: () => {},
          onLogout: () => {},
          open: true,
          onClose: () => {},
        }),
      ),
    );
    expect(html).not.toContain('Recruitment');
    expect(html).toContain('Sessions &amp; Devices');
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
          capabilities: recruiter,
          onNavigate: () => {},
          onLogout: () => {},
          open: true,
          onClose: () => {},
        })
      )
    );

    // Dropdown button should have aria-expanded="false"
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Recruitment');
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
