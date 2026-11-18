import { CalendarPicker } from '../../ui/CalendarPicker.js';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getCompanyLadder,
  getCompanyReportingManagers,
  type CompanyDepartment,
  type CompanyDesignation,
  type CompanyLadderPosition,
  type CompanyReportingManager,
  type CompanyTeam,
} from '../api/companyApi.js';
import type { ShiftTemplate, WeekdaySchedule } from '../api/shiftsApi.js';
import { missingScheduleNotice } from './schedule-notice.js';
import { createEmployee, getNextEmployeeId, type CreateEmployeeInput } from '../api/employeesApi.js';
import { getIdentitySessionSnapshot, IdentityApiError } from '../../identity/api/authApi.js';
import { ConfirmCancelButton } from '../../ui/ConfirmDiscardModal.js';
import {
  PHONE_COUNTRY_OPTIONS,
  formatFullPhone,
  phoneError,
  sanitizePhoneInput,
  splitPhoneAndCountryCode,
} from './phone.js';

export { PHONE_COUNTRY_OPTIONS } from './phone.js';

/**
 * Add Employee — HR or Super Admin enters only what the employee cannot give
 * themselves: who they are (name, work email, phone), where they sit in the
 * organization, their shift and their joining date.
 *
 * There is no password step. The employee gets an email, sets their own
 * password, and then completes the rest of their profile (personal details,
 * education, experience, documents) themselves. HR sees how far they got in
 * the Employees list.
 */

interface AddEmployeeWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (fullName: string, employeeId: string, workflowId: string, setupUrl?: string) => void;
  departments: CompanyDepartment[];
  teams: CompanyTeam[];
  designations: CompanyDesignation[];
  shifts: ShiftTemplate[];
  weekdaySchedules: WeekdaySchedule[];
}

interface FormState {
  fullName: string;
  email: string;
  phoneCountryCode: string;
  phone: string;
  employeeId: string;
  joiningDate: string;
  departmentId: string;
  positionId: string;
  teamId: string;
  reportsTo: string;
  designationId: string;
  specialization: string;
  shiftId: string;
  weekdayScheduleId: string;
}

type FieldErrors = Partial<Record<keyof FormState, string>>;

const EMPTY_FORM: FormState = {
  fullName: '',
  email: '',
  phoneCountryCode: '+91',
  phone: '',
  employeeId: '',
  joiningDate: '',
  departmentId: '',
  positionId: '',
  teamId: '',
  reportsTo: '',
  designationId: '',
  specialization: '',
  shiftId: '',
  weekdayScheduleId: '',
};

/** Fields filled in for every new form, so they say nothing about whether anything was entered. */
const PREFILLED: ReadonlySet<keyof FormState> = new Set(['phoneCountryCode', 'employeeId']);

/**
 * Drafts are kept per signed-in person and organization, so someone else
 * using the same browser never sees them. The old single-key draft also held
 * personal details; only the fields this form still has are carried over.
 */
const LEGACY_DRAFT_KEY = 'tapcrm.employee_wizard_draft';
function draftKey(): string | null {
  const { principalId, organizationId } = getIdentitySessionSnapshot();
  return principalId && organizationId ? `tapcrm.employee_draft.v2.${organizationId}.${principalId}` : null;
}

function readDraft(): Partial<FormState> | null {
  const key = draftKey();
  if (!key) return null;
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as Partial<FormState>;
    const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (!legacy) return null;
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    const old = JSON.parse(legacy) as Record<string, unknown>;
    const carried: Partial<FormState> = {};
    for (const field of Object.keys(EMPTY_FORM) as (keyof FormState)[]) {
      const value = old[field];
      if (typeof value === 'string') carried[field] = value;
    }
    localStorage.setItem(key, JSON.stringify(carried));
    return carried;
  } catch {
    return null;
  }
}

function writeDraft(form: FormState): boolean {
  const key = draftKey();
  if (!key) return false;
  try {
    localStorage.setItem(key, JSON.stringify(form));
    return true;
  } catch {
    return false;
  }
}

function clearDraft(): void {
  const key = draftKey();
  try {
    if (key) localStorage.removeItem(key);
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // Nothing stored.
  }
}

function hasEnteredDetails(form: FormState): boolean {
  return (Object.keys(form) as (keyof FormState)[]).some((key) => !PREFILLED.has(key) && form[key].trim() !== '');
}

function flattenPositions(positions: CompanyLadderPosition[], depth = 0): Array<{ value: string; label: string }> {
  return positions.flatMap((position) => [
    { value: position.id, label: `${'— '.repeat(depth)}${position.name} (${position.code})` },
    ...flattenPositions(position.children ?? [], depth + 1),
  ]);
}

const inputClass = (error?: string) =>
  `w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent disabled:opacity-50 ${
    error ? 'border-red-500' : 'border-app-border'
  }`;

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-app-muted">
      {children}
    </label>
  );
}

function FieldError({ message }: { message?: string | undefined }): React.JSX.Element | null {
  return message ? <p className="mt-1 text-xs text-red-500">{message}</p> : null;
}

export function AddEmployeeWizardModal({
  isOpen,
  onClose,
  onSuccess,
  departments,
  teams,
  designations,
  shifts,
  weekdaySchedules,
}: AddEmployeeWizardModalProps): React.JSX.Element | null {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  /**
   * The suggested ID is only a preview. Left untouched, the server picks the
   * number when saving, so two people adding employees at once never collide.
   */
  const [suggestedId, setSuggestedId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState(false);
  const [positions, setPositions] = useState<Array<{ value: string; label: string }>>([]);
  const [rootPositionIds, setRootPositionIds] = useState<Set<string>>(new Set());
  const [managers, setManagers] = useState<CompanyReportingManager[]>([]);
  const restoredRef = useRef(false);

  const scheduleNotice = missingScheduleNotice(shifts.length, weekdaySchedules.length);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  // Restore a saved draft once, when the form opens.
  useEffect(() => {
    if (!isOpen || restoredRef.current) return;
    restoredRef.current = true;
    const draft = readDraft();
    if (draft) {
      const restored = { ...EMPTY_FORM, ...draft };
      setForm(restored);
      setSavedSnapshot(JSON.stringify(restored));
      setDraftNotice('Restored your saved draft.');
    }
  }, [isOpen]);

  async function suggestEmployeeId(): Promise<void> {
    setLoadingId(true);
    try {
      const { nextEmployeeId } = await getNextEmployeeId();
      setSuggestedId(nextEmployeeId);
      setForm((current) => (current.employeeId ? current : { ...current, employeeId: nextEmployeeId }));
    } catch {
      // No preview: leaving the field empty lets the server number the employee.
      setSuggestedId(null);
    } finally {
      setLoadingId(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    void suggestEmployeeId();
    // Only once per opening; the button asks again on demand.
  }, [isOpen]);

  // Positions of the chosen department.
  useEffect(() => {
    const department = departments.find((d) => d.id === form.departmentId);
    if (!department) {
      setPositions([]);
      setRootPositionIds(new Set());
      return;
    }
    let cancelled = false;
    getCompanyLadder(department.code)
      .then((ladder) => {
        if (cancelled) return;
        setPositions(flattenPositions(ladder.positions));
        setRootPositionIds(new Set(ladder.positions.map((p) => p.id)));
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load positions for this department.');
      });
    return () => {
      cancelled = true;
    };
  }, [form.departmentId, departments]);

  const isRootPosition = form.positionId !== '' && rootPositionIds.has(form.positionId);

  // Who the person can report to, given department, position and team.
  useEffect(() => {
    if (!form.departmentId || !form.positionId || isRootPosition) {
      setManagers([]);
      if (isRootPosition) setForm((current) => (current.reportsTo ? { ...current, reportsTo: '' } : current));
      return;
    }
    let cancelled = false;
    getCompanyReportingManagers(form.departmentId, form.positionId, undefined, form.teamId || undefined)
      .then((list) => {
        if (cancelled) return;
        setManagers(list);
        // A manager from another team is no longer a valid choice.
        setForm((current) =>
          current.reportsTo && !list.some((m) => m.id === current.reportsTo) ? { ...current, reportsTo: '' } : current,
        );
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load reporting managers.');
      });
    return () => {
      cancelled = true;
    };
  }, [form.departmentId, form.positionId, form.teamId, isRootPosition]);

  if (!isOpen) return null;

  const departmentTeams = teams.filter((t) => t.departmentId === form.departmentId);
  const designation = designations.find((d) => d.id === form.designationId);
  // The suggested ID is not the person's input: a draft keeps it empty, so the
  // next free number is suggested again when the draft is reopened.
  const draftForm: FormState = { ...form, employeeId: form.employeeId === suggestedId ? '' : form.employeeId };
  const snapshot = JSON.stringify(draftForm);
  const hasUnsavedChanges = savedSnapshot === null ? hasEnteredDetails(form) : snapshot !== savedSnapshot;
  const discardTitle = savedSnapshot ? 'Discard your latest changes?' : 'Discard this new employee?';
  const discardDescription = savedSnapshot
    ? 'Your saved draft is kept, but changes made since you saved it will be lost.'
    : 'The details you entered will be lost. Use "Save as draft" first to keep them.';

  function validate(which: 1 | 2): FieldErrors {
    const next: FieldErrors = {};
    if (which === 1) {
      const name = form.fullName.trim();
      if (!name) next.fullName = 'Full name is required.';
      else if (!/^[\p{L}\s'.-]+$/u.test(name)) next.fullName = 'Use letters, spaces, hyphens and apostrophes only.';
      else if (name.length < 2 || name.length > 160) next.fullName = 'Full name must be 2 to 160 characters.';

      const email = form.email.trim();
      if (!email) next.email = 'Work email is required.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) next.email = 'Enter a valid email address.';

      const phoneProblem = phoneError(formatFullPhone(form.phoneCountryCode, form.phone), true);
      if (phoneProblem) next.phone = phoneProblem;

      const id = form.employeeId.trim();
      if (id && !/^[A-Z0-9][A-Z0-9-]{0,49}$/i.test(id)) {
        next.employeeId = 'Use letters, digits and hyphens only (max 50).';
      }

      if (!form.joiningDate) next.joiningDate = 'Joining date is required.';
      else if (Number.isNaN(Date.parse(form.joiningDate))) next.joiningDate = 'Enter a valid date.';
    } else {
      if (!form.departmentId) next.departmentId = 'Department is required.';
      if (!form.positionId) next.positionId = 'Position is required.';
      if (form.departmentId && departmentTeams.length > 0 && !form.teamId) {
        next.teamId = 'Choose the team this person joins.';
      }
      if (!form.shiftId) next.shiftId = 'Choose a shift.';
      if (!form.weekdayScheduleId) {
        next.weekdayScheduleId =
          weekdaySchedules.length === 0 ? 'Create an active weekday schedule first.' : 'Choose a weekday schedule.';
      }
    }
    return next;
  }

  function goNext(): void {
    const found = validate(1);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep(2);
  }

  function saveDraft(): void {
    if (writeDraft(draftForm)) {
      setSavedSnapshot(snapshot);
      setDraftNotice(`Draft saved at ${new Date().toLocaleTimeString()}.`);
    } else {
      setError('Unable to save a draft in this browser.');
    }
  }

  function discardDraft(): void {
    clearDraft();
    setSavedSnapshot(null);
    setDraftNotice(null);
  }

  async function submit(): Promise<void> {
    const first = validate(1);
    if (Object.keys(first).length > 0) {
      setErrors(first);
      setStep(1);
      return;
    }
    const second = validate(2);
    setErrors(second);
    if (Object.keys(second).length > 0) return;

    const employeeId = form.employeeId.trim().toUpperCase();
    // Send the ID only when HR typed their own; the suggestion is assigned by the server.
    const customId = employeeId && employeeId !== suggestedId ? employeeId : '';
    const payload: CreateEmployeeInput = {
      fullName: form.fullName.trim(),
      email: form.email.trim().toLowerCase(),
      phone: formatFullPhone(form.phoneCountryCode, form.phone),
      ...(customId ? { employeeId: customId } : {}),
      joiningDate: form.joiningDate,
      departmentId: form.departmentId,
      positionId: form.positionId,
      ...(form.teamId ? { teamId: form.teamId } : {}),
      ...(form.designationId ? { designationId: form.designationId } : {}),
      ...(form.specialization ? { specialization: form.specialization } : {}),
      reportsTo: form.reportsTo || null,
      shiftId: form.shiftId,
      weekdayScheduleId: form.weekdayScheduleId,
    };

    setBusy(true);
    setError('');
    try {
      const result = await createEmployee(payload);
      clearDraft();
      onSuccess(result.employee.fullName, result.employee.id, result.onboardingWorkflowId, result.setupUrl);
    } catch (cause) {
      setError(
        cause instanceof IdentityApiError || cause instanceof Error ? cause.message : 'Unable to create the employee.',
      );
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
      <div className="fixed inset-0 bg-[#080e17a6] backdrop-blur-sm" aria-hidden="true" />
      <dialog
        open
        className="ui-dialog z-50 my-auto flex max-h-[calc(100dvh-2rem)] w-[calc(100%-1.5rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface p-5 text-app-foreground shadow-2xl sm:max-h-[calc(100dvh-3.5rem)] sm:w-[calc(100%-2rem)] sm:p-6"
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold">Add employee</h2>
            <p className="mt-0.5 text-xs text-app-muted">
              Enter what only HR knows. The employee sets a password and fills in the rest themselves.
            </p>
          </div>
          <ConfirmCancelButton
            onDiscard={onClose}
            needsConfirmation={hasUnsavedChanges}
            title={discardTitle}
            description={discardDescription}
            discardText="Discard"
            continueText="Continue"
            aria-label="Close"
            className="grid size-8 place-items-center rounded-lg text-xl text-app-muted transition-colors hover:bg-app-background"
          >
            ×
          </ConfirmCancelButton>
        </div>

        <div className="my-4 flex shrink-0 items-center gap-4 px-1 text-xs font-semibold">
          {[
            { id: 1 as const, label: 'Basic details' },
            { id: 2 as const, label: 'Work setup' },
          ].map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-1.5 ${
                step === item.id ? 'font-bold text-app-accent' : step > item.id ? 'text-emerald-500' : 'text-app-muted'
              }`}
            >
              <span
                className={`grid size-5 place-items-center rounded-full text-[10px] ${
                  step === item.id
                    ? 'bg-app-accent text-app-on-accent'
                    : step > item.id
                      ? 'bg-emerald-500 text-white'
                      : 'bg-app-border text-app-muted'
                }`}
              >
                {step > item.id ? '✓' : item.id}
              </span>
              {item.label}
            </div>
          ))}
        </div>

        {scheduleNotice && (
          <div className="mb-3 shrink-0 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200" role="status">
            {scheduleNotice}
          </div>
        )}
        {error && (
          <div className="mb-3 shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500" role="alert">
            {error}
          </div>
        )}
        {draftNotice && (
          <div className="mb-3 flex shrink-0 items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-800 dark:text-emerald-200">
            <span>{draftNotice}</span>
            {savedSnapshot && (
              <button type="button" onClick={discardDraft} className="font-semibold text-red-500 hover:underline">
                Discard draft
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pb-4 pr-1">
          {step === 1 && (
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <Label htmlFor="wizard-fullName">Full name *</Label>
                <input
                  id="wizard-fullName"
                  type="text"
                  value={form.fullName}
                  onChange={(e) => set('fullName', e.target.value.replace(/[^\p{L}\s'.-]/gu, ''))}
                  placeholder="e.g. Priya Sharma"
                  className={inputClass(errors.fullName)}
                />
                <FieldError message={errors.fullName} />
              </div>
              <div>
                <Label htmlFor="wizard-email">Work email *</Label>
                <input
                  id="wizard-email"
                  type="email"
                  autoComplete="off"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value.trim())}
                  placeholder="priya@company.com"
                  className={inputClass(errors.email)}
                />
                <FieldError message={errors.email} />
                <p className="mt-1 text-[11px] text-app-muted">The password setup link is sent here.</p>
              </div>
              <div>
                <Label htmlFor="wizard-phone">Phone *</Label>
                <div className="flex gap-2">
                  <select
                    aria-label="Country code"
                    value={form.phoneCountryCode}
                    onChange={(e) => set('phoneCountryCode', e.target.value)}
                    className={`${inputClass()} w-28 shrink-0 px-2`}
                  >
                    {PHONE_COUNTRY_OPTIONS.map((option) => (
                      <option key={`${option.country}-${option.code}`} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    id="wizard-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.startsWith('+')) {
                        const parsed = splitPhoneAndCountryCode(value, form.phoneCountryCode);
                        setForm((current) => ({
                          ...current,
                          phoneCountryCode: parsed.countryCode,
                          phone: sanitizePhoneInput(parsed.nationalNumber),
                        }));
                        setErrors(({ phone: _phone, ...rest }) => rest);
                      } else {
                        set('phone', sanitizePhoneInput(value));
                      }
                    }}
                    placeholder="98765 43210"
                    className={`${inputClass(errors.phone)} min-w-0 flex-1`}
                  />
                </div>
                <FieldError message={errors.phone} />
              </div>
              <div>
                <Label htmlFor="wizard-joiningDate">Joining date *</Label>
                <input
                  id="wizard-joiningDate"
                  type="date"
                  value={form.joiningDate}
                  onChange={(e) => set('joiningDate', e.target.value)}
                  className={inputClass(errors.joiningDate)}
                />
                <FieldError message={errors.joiningDate} />
              </div>
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <Label htmlFor="wizard-employeeId">Employee ID</Label>
                  <button
                    type="button"
                    onClick={() => {
                      set('employeeId', '');
                      void suggestEmployeeId();
                    }}
                    disabled={loadingId}
                    className="text-[11px] font-semibold text-app-accent hover:underline disabled:opacity-50"
                  >
                    {loadingId ? 'Fetching…' : 'Use next number'}
                  </button>
                </div>
                <input
                  id="wizard-employeeId"
                  type="text"
                  value={form.employeeId}
                  onChange={(e) => set('employeeId', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                  placeholder="Leave empty to number automatically"
                  className={`${inputClass(errors.employeeId)} uppercase`}
                />
                <FieldError message={errors.employeeId} />
                <p className="mt-1 text-[11px] text-app-muted">
                  {suggestedId && form.employeeId === suggestedId
                    ? 'Next free number. It is confirmed when you create the employee.'
                    : 'Type your own ID (e.g. when moving from another HR system), or leave empty.'}
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <Label htmlFor="wizard-departmentId">Department *</Label>
                <select
                  id="wizard-departmentId"
                  value={form.departmentId}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      departmentId: e.target.value,
                      positionId: '',
                      teamId: '',
                      reportsTo: '',
                      designationId: '',
                      specialization: '',
                    }))
                  }
                  className={inputClass(errors.departmentId)}
                >
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.departmentId} />
              </div>
              <div>
                <Label htmlFor="wizard-positionId">Position *</Label>
                <select
                  id="wizard-positionId"
                  value={form.positionId}
                  disabled={!form.departmentId}
                  onChange={(e) => set('positionId', e.target.value)}
                  className={inputClass(errors.positionId)}
                >
                  <option value="">Select position</option>
                  {positions.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.positionId} />
              </div>
              <div>
                <Label htmlFor="wizard-teamId">Team{departmentTeams.length > 0 ? ' *' : ''}</Label>
                <select
                  id="wizard-teamId"
                  value={form.teamId}
                  disabled={!form.departmentId || departmentTeams.length === 0}
                  onChange={(e) => set('teamId', e.target.value)}
                  className={inputClass(errors.teamId)}
                >
                  <option value="">
                    {form.departmentId && departmentTeams.length === 0 ? 'This department has no teams' : 'Select team'}
                  </option>
                  {departmentTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.teamId} />
              </div>
              {isRootPosition ? (
                <div className="rounded-xl border border-app-border bg-app-background p-3 text-xs text-app-muted">
                  This position reports directly to the Company Super Admin.
                </div>
              ) : (
                <div>
                  <Label htmlFor="wizard-reportsTo">Reporting manager</Label>
                  <select
                    id="wizard-reportsTo"
                    value={form.reportsTo}
                    disabled={!form.positionId}
                    onChange={(e) => set('reportsTo', e.target.value)}
                    className={inputClass()}
                  >
                    <option value="">None for now</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.accountType === 'super-admin' ? `${m.fullName} (Company Super Admin)` : m.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <Label htmlFor="wizard-designationId">Designation</Label>
                <select
                  id="wizard-designationId"
                  value={form.designationId}
                  onChange={(e) => setForm((current) => ({ ...current, designationId: e.target.value, specialization: '' }))}
                  className={inputClass()}
                >
                  <option value="">None</option>
                  {designations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              {designation && designation.specializations.length > 0 && (
                <div>
                  <Label htmlFor="wizard-specialization">Specialization</Label>
                  <select
                    id="wizard-specialization"
                    value={form.specialization}
                    onChange={(e) => set('specialization', e.target.value)}
                    className={inputClass()}
                  >
                    <option value="">Select specialization</option>
                    {designation.specializations.map((spec) => (
                      <option key={spec} value={spec}>
                        {spec}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="wizard-joiningDate" className="mb-1 block text-xs font-semibold text-app-muted">Joining Date *</label>
                <CalendarPicker
                  id="wizard-joiningDate"
                  type="date"
                  required
                  value={joiningDate}
                  onChange={(e) => {
                    setJoiningDate(e.target.value);
                    clearFieldError('joiningDate');
                  }}
                  className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                    fieldErrors.joiningDate ? 'border-red-500' : 'border-app-border'
                  }`}
                />
                {fieldErrors.joiningDate && <p className="mt-1 text-xs text-red-500">{fieldErrors.joiningDate}</p>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid gap-3.5 sm:grid-cols-3">
                <div>
                  <label htmlFor="wizard-phone" className="mb-1 block text-xs font-semibold text-app-muted">Contact Phone *</label>
                  <div
                    className={`flex rounded-lg border bg-app-background transition-colors focus-within:border-app-accent focus-within:ring-1 focus-within:ring-app-accent/20 ${
                      fieldErrors.phone ? 'border-red-500' : 'border-app-border'
                    }`}
                  >
                    <select
                      id="wizard-phoneCountryCode"
                      value={phoneCountryCode}
                      onChange={(e) => {
                        setPhoneCountryCode(e.target.value);
                        clearFieldError('phone');
                      }}
                      aria-label="Contact phone country code"
                      className="w-[74px] sm:w-[78px] shrink-0 rounded-l-lg border-r border-app-border bg-app-surface-raised/60 px-1.5 py-2 text-xs font-semibold text-app-foreground outline-none cursor-pointer hover:bg-app-surface focus:bg-app-surface transition"
                    >
                      {PHONE_COUNTRY_OPTIONS.map((item) => (
                        <option key={`phone-${item.country}-${item.code}`} value={item.code}>
                          {item.country} {item.code}
                        </option>
                      ))}
                    </select>
                    <input
                      id="wizard-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.startsWith('+')) {
                          const parsed = splitPhoneAndCountryCode(val, phoneCountryCode);
                          setPhoneCountryCode(parsed.countryCode);
                          setPhone(sanitizePhoneInput(parsed.nationalNumber));
                        } else {
                          setPhone(sanitizePhoneInput(val));
                        }
                        clearFieldError('phone');
                      }}
                      onBlur={() => setPhone((v) => v.trim())}
                      placeholder="8240998467"
                      className="min-w-0 flex-1 rounded-r-lg bg-transparent px-3 py-2 text-sm outline-none placeholder:text-app-muted"
                    />
                  </div>
                  {fieldErrors.phone && <p className="mt-1 text-xs text-red-500">{fieldErrors.phone}</p>}
                </div>
                <div>
                  <label htmlFor="wizard-dateOfBirth" className="mb-1 block text-xs font-semibold text-app-muted">Date of Birth *</label>
                  <CalendarPicker
                    id="wizard-dateOfBirth"
                    type="date"
                    required
                    value={dateOfBirth}
                    onChange={(e) => {
                      setDateOfBirth(e.target.value);
                      clearFieldError('dateOfBirth');
                    }}
                    onBlur={() => setDateOfBirth((v) => v.trim())}
                    className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                      fieldErrors.dateOfBirth ? 'border-red-500' : 'border-app-border'
                    }`}
                  />
                  {fieldErrors.dateOfBirth && <p className="mt-1 text-xs text-red-500">{fieldErrors.dateOfBirth}</p>}
                </div>
                <div>
                  <label htmlFor="wizard-gender" className="mb-1 block text-xs font-semibold text-app-muted">Gender *</label>
                  <select
                    id="wizard-gender"
                    required
                    value={gender}
                    onChange={(e) => {
                      setGender(e.target.value);
                      clearFieldError('gender');
                    }}
                    className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                      fieldErrors.gender ? 'border-red-500' : 'border-app-border'
                    }`}
                  >
                    <option value="">Select gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Non-Binary">Non-Binary</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                  {fieldErrors.gender && <p className="mt-1 text-xs text-red-500">{fieldErrors.gender}</p>}
                </div>
              </div>

              <div className="rounded-xl border border-app-border bg-app-background/50 p-4">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-app-muted">Address Details</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="wizard-addressLine1" className="mb-1 block text-xs font-semibold text-app-muted">Street Address Line 1 *</label>
                    <input
                      id="wizard-addressLine1"
                      type="text"
                      required
                      value={addressLine1}
                      onChange={(e) => {
                        setAddressLine1(stripEmojis(e.target.value));
                        clearFieldError('addressLine1');
                      }}
                      onBlur={() => setAddressLine1((v) => v.trim())}
                      placeholder="Street Address Line 1"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.addressLine1 ? 'border-red-500' : 'border-app-border'
                      }`}
                    />
                    {fieldErrors.addressLine1 && <p className="mt-1 text-xs text-red-500">{fieldErrors.addressLine1}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="wizard-addressLine2" className="mb-1 block text-xs font-semibold text-app-muted">Line 2 (Apartment, suite, etc.) (Optional)</label>
                    <input
                      id="wizard-addressLine2"
                      type="text"
                      value={addressLine2}
                      onChange={(e) => setAddressLine2(stripEmojis(e.target.value))}
                      onBlur={() => setAddressLine2((v) => v.trim())}
                      placeholder="Line 2 (Apartment, suite, etc.) (Optional)"
                      className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
                    />
                  </div>
                  <div>
                    <label htmlFor="wizard-city" className="mb-1 block text-xs font-semibold text-app-muted">City *</label>
                    <input
                      id="wizard-city"
                      type="text"
                      required
                      value={city}
                      onChange={(e) => {
                        setCity(sanitizeNameInput(e.target.value));
                        clearFieldError('city');
                      }}
                      onBlur={() => setCity((v) => v.trim())}
                      placeholder="City"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.city ? 'border-red-500' : 'border-app-border'
                      }`}
                    />
                    {fieldErrors.city && <p className="mt-1 text-xs text-red-500">{fieldErrors.city}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="wizard-state" className="mb-1 block text-xs font-semibold text-app-muted">State *</label>
                      <input
                        id="wizard-state"
                        type="text"
                        required
                        value={state}
                        onChange={(e) => {
                          setState(sanitizeNameInput(e.target.value));
                          clearFieldError('state');
                        }}
                        onBlur={() => setState((v) => v.trim())}
                        placeholder="State"
                        className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                          fieldErrors.state ? 'border-red-500' : 'border-app-border'
                        }`}
                      />
                      {fieldErrors.state && <p className="mt-1 text-xs text-red-500">{fieldErrors.state}</p>}
                    </div>
                    <div>
                      <label htmlFor="wizard-postalCode" className="mb-1 block text-xs font-semibold text-app-muted">Postal Code *</label>
                      <input
                        id="wizard-postalCode"
                        type="text"
                        required
                        value={postalCode}
                        onChange={(e) => {
                          setPostalCode(sanitizeDigitsOnly(e.target.value, 10));
                          clearFieldError('postalCode');
                        }}
                        onBlur={() => setPostalCode((v) => v.trim())}
                        placeholder="Postal Code (e.g. 110001)"
                        className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                          fieldErrors.postalCode ? 'border-red-500' : 'border-app-border'
                        }`}
                      />
                      {fieldErrors.postalCode && <p className="mt-1 text-xs text-red-500">{fieldErrors.postalCode}</p>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-app-border bg-app-background/50 p-4">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-app-muted">Emergency Contact</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="wizard-emergencyContactName" className="mb-1 block text-xs font-semibold text-app-muted">Contact Name *</label>
                    <input
                      id="wizard-emergencyContactName"
                      type="text"
                      required
                      value={emergencyContactName}
                      onChange={(e) => {
                        setEmergencyContactName(sanitizeNameInput(e.target.value));
                        clearFieldError('emergencyContactName');
                      }}
                      onBlur={() => setEmergencyContactName((v) => v.trim())}
                      placeholder="Contact Name"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.emergencyContactName ? 'border-red-500' : 'border-app-border'
                      }`}
                    />
                    {fieldErrors.emergencyContactName && <p className="mt-1 text-xs text-red-500">{fieldErrors.emergencyContactName}</p>}
                  </div>
                  <div>
                    <label htmlFor="wizard-emergencyContactPhone" className="mb-1 block text-xs font-semibold text-app-muted">Contact Phone *</label>
                    <div
                      className={`flex rounded-lg border bg-app-background transition-colors focus-within:border-app-accent focus-within:ring-1 focus-within:ring-app-accent/20 ${
                        fieldErrors.emergencyContactPhone ? 'border-red-500' : 'border-app-border'
                      }`}
                    >
                      <select
                        id="wizard-emergencyContactCountryCode"
                        value={emergencyContactCountryCode}
                        onChange={(e) => {
                          setEmergencyContactCountryCode(e.target.value);
                          clearFieldError('emergencyContactPhone');
                        }}
                        aria-label="Emergency contact phone country code"
                        className="w-24 shrink-0 rounded-l-lg border-r border-app-border bg-app-surface-raised/60 px-2 py-2 text-xs font-semibold text-app-foreground outline-none cursor-pointer hover:bg-app-surface focus:bg-app-surface transition"
                      >
                        {PHONE_COUNTRY_OPTIONS.map((item) => (
                          <option key={`emg-${item.country}-${item.code}`} value={item.code}>
                            {item.code} {item.country}
                          </option>
                        ))}
                      </select>
                      <input
                        id="wizard-emergencyContactPhone"
                        type="tel"
                        required
                        value={emergencyContactPhone}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val.startsWith('+')) {
                            const parsed = splitPhoneAndCountryCode(val, emergencyContactCountryCode);
                            setEmergencyContactCountryCode(parsed.countryCode);
                            setEmergencyContactPhone(sanitizePhoneInput(parsed.nationalNumber));
                          } else {
                            setEmergencyContactPhone(sanitizePhoneInput(val));
                          }
                          clearFieldError('emergencyContactPhone');
                        }}
                        onBlur={() => setEmergencyContactPhone((v) => v.trim())}
                        placeholder="9876543210"
                        className="min-w-0 flex-1 rounded-r-lg bg-transparent px-3 py-2 text-sm outline-none placeholder:text-app-muted"
                      />
                    </div>
                    {fieldErrors.emergencyContactPhone && (
                      <p className="mt-1 text-xs text-red-500">{fieldErrors.emergencyContactPhone}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="wizard-emergencyContactRelation" className="mb-1 block text-xs font-semibold text-app-muted">Relationship *</label>
                    <input
                      id="wizard-emergencyContactRelation"
                      type="text"
                      required
                      value={emergencyContactRelation}
                      onChange={(e) => {
                        setEmergencyContactRelation(sanitizeNameInput(e.target.value));
                        clearFieldError('emergencyContactRelation');
                      }}
                      onBlur={() => setEmergencyContactRelation((v) => v.trim())}
                      placeholder="Relationship (e.g. Spouse)"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.emergencyContactRelation ? 'border-red-500' : 'border-app-border'
                      }`}
                    />
                    {fieldErrors.emergencyContactRelation && <p className="mt-1 text-xs text-red-500">{fieldErrors.emergencyContactRelation}</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="wizard-shiftId" className="mb-1 block text-xs font-semibold text-app-muted">Assigned Shift Schedule *</label>
                <select
                  id="wizard-shiftId"
                  value={form.shiftId}
                  onChange={(e) => set('shiftId', e.target.value)}
                  className={inputClass(errors.shiftId)}
                >
                  <option value="">Select shift</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.kind === 'fixed' ? `${s.startTime ?? ''} - ${s.endTime ?? ''}` : 'Flexible'})
                    </option>
                  ))}
                </select>
                <FieldError message={errors.shiftId} />
              </div>
              <div>
                <Label htmlFor="wizard-weekdayScheduleId">Weekday schedule *</Label>
                <select
                  id="wizard-weekdayScheduleId"
                  value={form.weekdayScheduleId}
                  onChange={(e) => set('weekdayScheduleId', e.target.value)}
                  className={inputClass(errors.weekdayScheduleId)}
                >
                  <option value="">Select weekday schedule</option>
                  {weekdaySchedules.map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      {schedule.name}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.weekdayScheduleId} />
              </div>
              <div className="rounded-xl border border-app-accent/20 bg-app-accent/5 p-3.5 text-xs text-app-muted sm:col-span-2">
                <p className="font-bold text-app-foreground">What happens next</p>
                <p className="mt-1">
                  {form.fullName.trim() || 'The employee'} gets an email to set their password. After signing in they are
                  asked to complete their profile — personal details, education, experience and documents. You can follow
                  their progress in the Employees list. The onboarding checklist starts automatically.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex shrink-0 items-center justify-between gap-2 border-t border-app-border/70 pt-4">
          <div className="flex items-center gap-2">
            <ConfirmCancelButton
              onDiscard={onClose}
              needsConfirmation={hasUnsavedChanges}
              title={discardTitle}
              description={discardDescription}
              discardText="Discard"
              continueText="Continue"
              className="rounded-lg border border-app-border px-4 py-2 text-sm font-semibold transition-colors hover:border-app-accent hover:text-red-500"
            >
              Cancel
            </ConfirmCancelButton>
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border border-app-border px-4 py-2 text-sm font-semibold hover:border-app-accent"
              >
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveDraft}
              className="rounded-lg border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold transition-colors hover:border-app-accent"
            >
              Save as draft
            </button>
            {step === 1 ? (
              <button
                type="button"
                onClick={goNext}
                className="rounded-lg bg-app-accent px-5 py-2 text-sm font-bold text-app-on-accent transition-opacity hover:opacity-90"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy ? 'Creating…' : 'Create & send invite'}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
