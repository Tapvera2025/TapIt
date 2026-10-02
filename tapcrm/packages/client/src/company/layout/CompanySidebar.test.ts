import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
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

    // Dropdown button should have aria-expanded="true"
    expect(html).toContain('aria-expanded="true"');
    // Dropdown child items should be visible
    expect(html).toContain('Resume Inbox');
    expect(html).toContain('Candidates');
    expect(html).toContain('Requisitions');
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
});
