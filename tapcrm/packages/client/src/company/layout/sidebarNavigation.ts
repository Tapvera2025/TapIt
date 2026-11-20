import {
  navigationFor,
  type CompanyNavGroup,
  type ScreenAccessSubject,
  type ScreenCapability,
} from './navigation.js';

export type SidebarVariant = 'company' | 'client' | 'platform';

/**
 * Everything that decides which menu entries a user sees. The company menu is
 * a pure view over the screen list in navigation.ts: what a person sees follows
 * the powers the server resolved for them, the modules switched on for the
 * company and their account type. Nothing here reads names of departments or
 * positions.
 */
export interface SidebarNavigationInput {
  variant?: SidebarVariant;
  accountType: string;
  /** Modules enabled for the company; omitted means every module is offered. */
  enabledModules?: readonly string[] | undefined;
  /** The powers the server resolved for this session (`/identity/me` capabilities). */
  capabilities?: readonly ScreenCapability[] | undefined;
  /** Sits on an interview panel: "My Interviews" is listed (data, not a permission). */
  hasInterviews?: boolean | undefined;
}

/** The menu groups one user sees. Groups with no entries are already removed. */
export function buildSidebarNavigation(input: SidebarNavigationInput): CompanyNavGroup[] {
  const variant = input.variant ?? 'company';
  // Client and platform menus are fixed and not module-gated.
  if (variant !== 'company') return fixedNavigation(variant);
  const subject: ScreenAccessSubject = {
    accountType: input.accountType,
    enabledModules: input.enabledModules,
    capabilities: input.capabilities,
    hasInterviews: input.hasInterviews,
  };
  return navigationFor(subject);
}

function fixedNavigation(variant: 'client' | 'platform'): CompanyNavGroup[] {
  return variant === 'client'
    ? [
        {
          label: 'Overview',
          items: [
            { label: 'Dashboard', path: '/client', icon: 'grid' },
            { label: 'Projects', path: '/client/projects', icon: 'briefcase' },
            { label: 'Messages', path: '/client/messages', icon: 'message' },
            { label: 'Meetings', path: '/client/meetings', icon: 'calendar' },
            { label: 'Social accounts', path: '/client/social', icon: 'share' },
          ],
        },
        {
          label: 'Account',
          items: [
            { label: 'Profile', path: '/client/profile', icon: 'users' },
            { label: 'Settings', path: '/client/settings', icon: 'settings' },
          ],
        },
      ]
    : [
        {
          label: 'Platform',
          items: [
            { label: 'Platform Dashboard', path: '/platform', icon: 'grid' },
            { label: 'Companies', path: '/platform/companies', icon: 'building' },
            {
              label: 'Admin Invitations',
              path: '/platform/invitations',
              icon: 'users',
            },
            { label: 'Mail Center', path: '/platform/mail', icon: 'inbox' },
          ],
        },
      ];
}
