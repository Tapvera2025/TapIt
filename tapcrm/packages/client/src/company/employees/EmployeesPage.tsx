import { useEffect, useState } from 'react';
import {
  listInactiveEmployees,
  resetEmployeePassword,
  type InactiveEmployee,
} from '../api/employeesApi.js';
import { EditEmployeeModal } from './EditEmployeeModal.js';
import { AddEmployeeWizardModal } from './AddEmployeeWizardModal.js';
import { OnboardingChecklistDrawer } from './OnboardingChecklistDrawer.js';
import { EmployeeVerificationModal } from './EmployeeVerificationModal.js';
import {
  getCompanyDepartments,
  getCompanyDesignations,
  getCompanyEmployees,
  getCompanyTeams,
  type CompanyDepartment,
  type CompanyDesignation,
  type CompanyEmployee,
  type CompanyTeam,
} from '../api/companyApi.js';
import { listShifts, type ShiftTemplate } from '../api/shiftsApi.js';
import { SkeletonTableRows } from '../../ui/components.js';

// ── Avatar helpers ────────────────────────────────────────────────────────────

const AVATAR_PALETTES = [
  { bg: '#fff4e6', fg: '#b94c0c' },
  { bg: '#e6f4ea', fg: '#2e7d32' },
  { bg: '#e8f0fe', fg: '#1a5fb4' },
  { bg: '#fce4ec', fg: '#b71c1c' },
  { bg: '#ede7f6', fg: '#4527a0' },
  { bg: '#e0f7fa', fg: '#006064' },
  { bg: '#fff8e1', fg: '#f57f17' },
  { bg: '#f3e5f5', fg: '#6a1b9a' },
];

function getAvatarStyle(name: string) {
  return AVATAR_PALETTES[name.charCodeAt(0) % AVATAR_PALETTES.length]!;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EmployeesPage({
  canManage = true,
  isSuperAdmin = false,
  canRequestRoleChange = false,
  onNavigate,
}: {
  canManage?: boolean;
  isSuperAdmin?: boolean;
  canRequestRoleChange?: boolean;
  onNavigate?: (path: string) => void;
} = {}): React.JSX.Element {
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inactive, setInactive] = useState<InactiveEmployee[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [departments, setDepartments] = useState<CompanyDepartment[]>([]);
  const [teams, setTeams] = useState<CompanyTeam[]>([]);
  const [designations, setDesignations] = useState<CompanyDesignation[]>([]);
  const [shifts, setShifts] = useState<ShiftTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [onboardingEmployee, setOnboardingEmployee] = useState<{ id: string; name: string; setupUrl?: string | null | undefined } | null>(null);
  const [verifyingEmployee, setVerifyingEmployee] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetTarget, setResetTarget] = useState<{ id: string; fullName: string } | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetDone, setResetDone] = useState(false);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const [nextEmployees, nextDepartments, nextTeams, nextDesignations, nextShifts] =
        await Promise.all([
          getCompanyEmployees(),
          getCompanyDepartments(),
          getCompanyTeams(),
          getCompanyDesignations(),
          listShifts(),
        ]);
      setEmployees(nextEmployees);
      setDepartments(nextDepartments.filter((item) => item.status === 'active'));
      setTeams(nextTeams);
      setDesignations(nextDesignations.filter((item) => item.status === 'active'));
      setShifts(nextShifts.filter((s) => s.status === 'active'));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load employees.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!showInactive) return;
    listInactiveEmployees()
      .then(setInactive)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Unable to load deactivated employees.'),
      );
  }, [showInactive]);

  const visible = employees.filter((employee) =>
    employee.fullName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-5 md:p-8">
      <div className="mx-auto max-w-7xl">

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="page-heading flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">
              People
            </p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.05em]">
              Employees
            </h1>
            <p className="mt-2 text-sm text-app-muted">
              {loading
                ? 'Loading…'
                : `${employees.length} member${employees.length !== 1 ? 's' : ''} in your organization`}
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                id="toggle-deactivated-btn"
                onClick={() => setShowInactive((open) => !open)}
                className="rounded-xl border border-app-border px-4 py-2.5 text-sm font-semibold hover:border-app-accent"
              >
                {showInactive ? 'Hide deactivated' : 'Deactivated employees'}
              </button>
              <button
                type="button"
                id="create-employee-btn"
                onClick={() => setShowCreate(true)}
                className="ui-primary flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                Create employee
              </button>
            </div>
          )}
        </div>

        {/* ── Alerts ──────────────────────────────────────────────────────── */}
        {message && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-app-accent/30 bg-app-accent/8 px-4 py-3 text-sm text-app-accent">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {message}
          </div>
        )}
        {error && (
          <p className="mt-4 rounded-xl border border-app-danger/30 bg-app-danger/8 px-4 py-3 text-sm text-app-danger">
            {error}
          </p>
        )}

        {/* ── Add employee wizard ──────────────────────────────────────────── */}
        {showCreate && (
          <AddEmployeeWizardModal
            isOpen={showCreate}
            onClose={() => setShowCreate(false)}
            onSuccess={(name, employeeId, _workflowId, setupUrl) => {
              setMessage(`Employee ${name} created and 9-step onboarding workflow initialized.`);
              setShowCreate(false);
              void load();
              setOnboardingEmployee({ id: employeeId, name, setupUrl: setupUrl ?? null });
            }}
            departments={departments}
            teams={teams}
            designations={designations}
            shifts={shifts}
          />
        )}

        {/* ── Employee list ────────────────────────────────────────────────── */}
        <div className="mt-6">
          {loading ? (
            <SkeletonTableRows count={5} />
          ) : employees.length === 0 ? (
            /* Empty state */
            <div className="rounded-2xl border border-app-border bg-app-surface px-6 py-14 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-app-accent/10">
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true" className="text-app-accent">
                  <circle cx="13" cy="9" r="5" stroke="currentColor" strokeWidth="2" />
                  <path d="M4 22c0-4.97 4.03-9 9-9s9 4.03 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="font-display text-xl font-bold">No employees yet</h2>
              <p className="mt-2 text-sm text-app-muted">
                Get started by creating the first employee account.
              </p>
              {canManage && (
                <button
                  type="button"
                  id="empty-create-btn"
                  onClick={() => setShowCreate(true)}
                  className="ui-primary mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold"
                >
                  Create first employee
                </button>
              )}
            </div>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-app-border bg-app-surface">
              {/* Search */}
              <div className="flex items-center gap-3 border-b border-app-border px-4 py-3">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className="shrink-0 text-app-muted">
                  <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  id="employee-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name…"
                  aria-label="Search employees"
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ border: 'none', boxShadow: 'none' }}
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearch('')}
                    className="flex items-center rounded-md p-1 text-app-muted hover:text-app-foreground"
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                      <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
                <span className="shrink-0 text-xs text-app-muted">
                  {visible.length}/{employees.length}
                </span>
              </div>

              {/* Column header row */}
              <div className="grid grid-cols-[1fr_auto] border-b border-app-border bg-app-surface-raised px-5 py-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-app-muted">Employee</span>
                <span className="text-[11px] font-bold uppercase tracking-widest text-app-muted">Actions</span>
              </div>

              {/* Rows */}
              {visible.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-app-muted">
                  No employees match &ldquo;{search}&rdquo;
                </p>
              ) : (
                <div className="divide-y divide-app-border">
                  {visible.map((employee, idx) => {
                    const av = getAvatarStyle(employee.fullName);
                    const metaParts = [
                      employee.departmentName,
                      employee.positionName
                        ? `${employee.positionName}${employee.positionCode ? ` (${employee.positionCode})` : ''}`
                        : null,
                      employee.teamName,
                      employee.designationName,
                    ].filter(Boolean);

                    return (
                      <div
                        key={employee.id}
                        id={`employee-row-${employee.id}`}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-5 py-4 transition-colors duration-150 hover:bg-app-accent/[0.03] sm:items-center"
                        style={{ animationDelay: `${Math.min(idx * 35, 280)}ms` }}
                      >
                        {/* Identity — takes the flexible left column */}
                        <div className="flex min-w-0 items-start gap-3.5">
                          {/* Avatar */}
                          <div
                            className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[13px] font-extrabold"
                            style={{
                              background: av.bg,
                              color: av.fg,
                              border: `1.5px solid ${av.fg}22`,
                              letterSpacing: '-0.02em',
                            }}
                          >
                            {getInitials(employee.fullName)}
                          </div>
                          <div className="min-w-0">
                            <p className="break-words text-sm font-bold text-app-foreground">
                              {employee.fullName}
                            </p>
                            <p className="break-all text-xs text-app-muted">
                              {employee.email ?? 'Employee account'}
                            </p>
                            {metaParts.length > 0 && (
                              <p className="mt-0.5 break-words text-[11.5px] text-app-muted">
                                {metaParts.join(' · ')}
                              </p>
                            )}
                            {(employee.specialization || employee.reportsToName) && (
                              <p className="mt-0.5 break-words text-[11px] text-app-muted">
                                {employee.specialization && (
                                  <>
                                    <span className="font-semibold text-app-foreground">Spec:</span>{' '}
                                    {employee.specialization}
                                    {employee.reportsToName ? ' · ' : ''}
                                  </>
                                )}
                                {employee.reportsToName && (
                                  <>
                                    <span className="font-semibold text-app-foreground">Reports to:</span>{' '}
                                    {employee.reportsToName}
                                  </>
                                )}
                              </p>
                            )}
                          </div>
                        </div>

                        {/*
                          Actions — independent right column on desktop (auto width, never pushed out).
                          On mobile this column is a 2×2 grid spanning both grid columns
                          so all four actions are fully visible and touchable.
                        */}
                        <div className="col-span-2 grid grid-cols-2 gap-1.5 sm:col-span-1 sm:flex sm:shrink-0 sm:flex-wrap">
                          {canManage && (
                            <ActionPill
                              id={`edit-btn-${employee.id}`}
                              label="Edit"
                              variant="neutral"
                              onClick={() => setEditingId(employee.id)}
                            />
                          )}
                          <ActionPill
                            id={`onboarding-btn-${employee.id}`}
                            label="Onboarding"
                            variant="accent"
                            onClick={() => setOnboardingEmployee({ id: employee.id, name: employee.fullName })}
                          />
                          <ActionPill
                            id={`verify-btn-${employee.id}`}
                            label="Verify"
                            variant="success"
                            onClick={() => setVerifyingEmployee({ id: employee.id, name: employee.fullName })}
                          />
                          {canManage && (
                            <ActionPill
                              id={`reset-pw-btn-${employee.id}`}
                              label="Reset password"
                              variant="neutral"
                              onClick={() => {
                                setResetTarget({ id: employee.id, fullName: employee.fullName });
                                setResetPw('');
                                setResetConfirm('');
                                setResetError('');
                                setResetDone(false);
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>

        {/* ── Deactivated employees ────────────────────────────────────────── */}
        {showInactive && inactive && (
          <div className="mt-5">
            <section className="overflow-hidden rounded-2xl border border-app-border bg-app-surface">
              <div className="flex items-center gap-2 border-b border-app-border bg-app-surface-raised px-5 py-3">
                <span className="text-sm font-semibold text-app-foreground">Deactivated employees</span>
                <span className="rounded-full bg-app-border px-2 py-0.5 text-[11px] font-bold text-app-muted">
                  {inactive.length}
                </span>
              </div>
              {inactive.length === 0 ? (
                <p className="px-5 py-5 text-sm text-app-muted">Nobody is deactivated.</p>
              ) : (
                <div className="divide-y divide-app-border">
                  {inactive.map((person) => (
                    <div
                      key={person.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-app-foreground">{person.fullName}</p>
                        <p className="text-xs text-app-muted">
                          {[person.employeeId, person.departmentName, person.positionName]
                            .filter(Boolean)
                            .join(' · ')}
                          {person.leftOn ? ` · left ${person.leftOn}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        id={`open-inactive-${person.id}`}
                        onClick={() => setEditingId(person.id)}
                        className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-semibold hover:border-app-accent"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {editingId && (
        <EditEmployeeModal
          userId={editingId}
          departments={departments}
          teams={teams}
          designations={designations}
          isSuperAdmin={isSuperAdmin}
          canRequestRoleChange={canRequestRoleChange}
          onClose={() => setEditingId(null)}
          onSaved={(text) => {
            setMessage(text);
            setEditingId(null);
            setInactive(null);
            if (showInactive) void listInactiveEmployees().then(setInactive).catch(() => undefined);
            void load();
          }}
          {...(onNavigate ? { onRequestRoleChange: () => onNavigate('/company/role-change-request') } : {})}
        />
      )}

      {resetTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Reset employee password"
        >
          <div className="w-full max-w-sm rounded-2xl border border-app-border bg-app-surface p-7 shadow-2xl">
            <h2 className="font-display text-lg font-extrabold text-app-foreground">Reset password</h2>
            <p className="mt-1.5 text-sm text-app-muted leading-relaxed">
              Set a new temporary password for{' '}
              <span className="font-bold text-app-foreground">{resetTarget.fullName}</span>.
              They will be required to change it on next login.
            </p>

            {resetDone ? (
              <div className="mt-4 rounded-xl border border-app-success/25 bg-app-success/10 px-4 py-3 text-sm text-app-success">
                Password reset. The employee must change it on their next login.
              </div>
            ) : (
              <form
                className="mt-5 space-y-3.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (resetPw.length < 12) { setResetError('Password must be at least 12 characters.'); return; }
                  if (resetPw !== resetConfirm) { setResetError('Passwords do not match.'); return; }
                  setResetBusy(true);
                  setResetError('');
                  resetEmployeePassword(resetTarget.id, resetPw)
                    .then(() => { setResetDone(true); })
                    .catch((err: unknown) => { setResetError(err instanceof Error ? err.message : 'Failed to reset password.'); })
                    .finally(() => { setResetBusy(false); });
                }}
              >
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-app-muted">
                    New password (min 12 characters)
                  </span>
                  <input
                    type="password"
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                    required
                    autoFocus
                    className="w-full rounded-xl border border-app-border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-app-muted">Confirm password</span>
                  <input
                    type="password"
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    required
                    className="w-full rounded-xl border border-app-border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent"
                  />
                </label>
                {resetError && (
                  <p className="text-xs text-app-danger">{resetError}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    id="reset-pw-submit-btn"
                    disabled={resetBusy}
                    className="ui-primary flex-1 rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
                  >
                    {resetBusy ? 'Resetting…' : 'Reset password'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetTarget(null)}
                    className="flex-1 rounded-xl border border-app-border py-2.5 text-sm font-semibold hover:border-app-accent"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {resetDone && (
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="mt-4 w-full rounded-xl border border-app-border py-2.5 text-sm font-semibold hover:border-app-accent"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {onboardingEmployee && (
        <OnboardingChecklistDrawer
          isOpen={true}
          employeeId={onboardingEmployee.id}
          employeeName={onboardingEmployee.name}
          setupUrl={onboardingEmployee.setupUrl}
          onClose={() => setOnboardingEmployee(null)}
        />
      )}

      {verifyingEmployee && (
        <EmployeeVerificationModal
          isOpen={true}
          employeeId={verifyingEmployee.id}
          employeeName={verifyingEmployee.name}
          canManage={canManage}
          onClose={() => setVerifyingEmployee(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const PILL_CLASSES: Record<string, string> = {
  neutral:
    'border-app-border text-app-foreground hover:border-app-accent hover:text-app-accent',
  accent:
    'border-app-accent/35 bg-app-accent/8 text-app-accent hover:bg-app-accent hover:text-app-on-accent hover:border-app-accent',
  success:
    'border-emerald-500/35 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500 hover:text-white hover:border-emerald-500',
};

function ActionPill({
  label,
  variant,
  onClick,
  id,
}: {
  label: string;
  variant: 'neutral' | 'accent' | 'success';
  onClick: () => void;
  id?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      /*
       * w-full makes the button fill its grid cell on mobile (2-col grid),
       * giving each action a 50%-minus-gap width that never overflows.
       * On sm+ the parent switches to flex so w-full is overridden by auto flex sizing.
       */
      className={`w-full justify-center rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors duration-150 sm:w-auto sm:justify-start sm:py-1 ${PILL_CLASSES[variant] ?? ''}`}
    >
      {label}
    </button>
  );
}
