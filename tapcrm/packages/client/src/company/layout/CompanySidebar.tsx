import { BrandLogo } from '../../ui/BrandLogo.js';
import { Icon } from '../../ui/Icon.js';
import { companyNavigation } from './navigation.js';
import { ThemeToggle } from '../../theme/ThemeToggle.js';
import { useState } from 'react';

export function CompanySidebar({
  pathname,
  identity,
  organizationName,
  accountType,
  canRequestRoleChange,
  canViewAudit,
  onNavigate,
  onLogout,
  open,
  onClose,
}: {
  pathname: string;
  identity: { fullName: string; email: string };
  organizationName: string | null;
  accountType: string;
  canRequestRoleChange: boolean;
  canViewAudit: boolean;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [organizationOpen, setOrganizationOpen] = useState(
    pathname.startsWith('/company/organization'),
  );
  const navigation =
    accountType === 'super-admin'
      ? companyNavigation
      : [
          {
            label: 'Overview',
            items: [{ label: 'Dashboard', path: '/company/dashboard', icon: 'grid' }],
          },
          {
            label: 'Identity & Access',
            items: [
              { label: 'Sessions & Devices', path: '/company/sessions', icon: 'monitor' },
              ...(accountType === 'employee' && canRequestRoleChange
                ? [
                    {
                      label: 'Request Role Change',
                      path: '/company/role-change-request',
                      icon: 'briefcase',
                    },
                  ]
                : []),
              ...(accountType === 'employee' && canViewAudit
                ? [{ label: 'Audit Log', path: '/company/audit', icon: 'clipboard' }]
                : []),
            ],
          },
        ];
  return (
    <aside
      className={`workspace-sidebar fixed inset-y-0 left-0 z-40 flex h-dvh min-h-0 w-64 flex-col border-r border-app-border bg-app-surface px-4 py-5 transition-transform md:static md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className="flex shrink-0 items-center justify-between px-3">
        <div>
          <BrandLogo className="w-[176px]" />
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-app-muted">
            Company Workspace
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-app-muted hover:bg-app-background md:hidden"
          aria-label="Close navigation"
        >
          ×
        </button>
      </div>
      <nav
        className="mt-8 min-h-0 flex-1 space-y-7 overflow-y-auto"
        aria-label="Company navigation"
      >
        {navigation.map((group) => {
          const isOrganization = group.label === 'Organization';
          const activeChild = group.items.some(
            (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
          );
          return (
            <div key={group.label}>
              {isOrganization ? (
                <button
                  type="button"
                  onClick={() => setOrganizationOpen((openState) => !openState)}
                  aria-expanded={organizationOpen}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.16em] ${activeChild ? 'bg-app-accent/15 text-app-accent' : 'text-app-muted hover:bg-app-background hover:text-app-foreground'}`}
                >
                  <span>Organization</span>
                  <span aria-hidden="true">{organizationOpen ? '−' : '+'}</span>
                </button>
              ) : (
                <p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-app-muted">
                  {group.label}
                </p>
              )}
              {(!isOrganization || organizationOpen) && (
                <div className="mt-2 space-y-1">
                  {group.items.map((item) => (
                    <button
                      key={item.path}
                      aria-current={
                        pathname === item.path ||
                        (item.path !== '/company/organization' &&
                          pathname.startsWith(`${item.path}/`))
                          ? 'page'
                          : undefined
                      }
                      type="button"
                      onClick={() => {
                        onNavigate(item.path);
                        onClose();
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${pathname === item.path || (item.path !== '/company/organization' && pathname.startsWith(`${item.path}/`)) ? 'bg-app-accent/15 text-app-accent' : 'text-app-muted hover:bg-app-background hover:text-app-foreground'}`}
                    >
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div className="sidebar-decoration">
          <p className="text-sm font-medium leading-5">
            Work smarter.
            <br />
            Grow together.
          </p>
          <div className="mt-3 h-1 w-10 rounded-full bg-app-accent" />
        </div>
      </nav>
      <div className="shrink-0 border-t border-app-border pt-4">
        <div className="mb-4 px-3">
          <ThemeToggle />
        </div>
        <p className="truncate px-3 text-sm font-bold">{identity.fullName}</p>
        <p className="mt-1 truncate px-3 text-xs text-app-muted">{identity.email}</p>
        <p
          className="mt-1 truncate px-3 text-[11px] font-semibold text-app-accent"
          title={organizationName ?? undefined}
        >
          {organizationName ?? 'Organization unavailable'}
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="mt-3 w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-app-danger hover:bg-[#d86b6b]/10"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
