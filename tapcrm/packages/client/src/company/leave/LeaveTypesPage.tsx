import { useEffect, useState, type FormEvent } from 'react';
import {
  listLeaveTypes,
  createLeaveType,
  updateLeaveType,
  type LeaveTypeDto,
} from '../api/leaveApi.js';
import { suggestNextCode } from '../../ui/code-suggest.js';
import { SkeletonTable } from '../../ui/components.js';

type FormMode = null | 'create' | LeaveTypeDto;

export function LeaveTypesPage(): React.JSX.Element {
  const [types, setTypes] = useState<LeaveTypeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<FormMode>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [lastCode, setLastCode] = useState('');

  // Create-only fields
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'absence' | 'attendance-mode'>('absence');

  // Shared fields
  const [name, setName] = useState('');
  const [accrualDays, setAccrualDays] = useState('0');
  const [paidLeave, setPaidLeave] = useState(true);
  const [enforcement, setEnforcement] = useState(false);

  // Edit-only fields
  const [isActive, setIsActive] = useState(true);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setTypes(await listLeaveTypes());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leave types.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreate(): void {
    setCode(suggestNextCode(types.map((t) => t.code), lastCode || undefined));
    setKind('absence');
    setName('');
    setAccrualDays('0');
    setPaidLeave(true);
    setEnforcement(false);
    setFormError(null);
    setSavedMessage(null);
    setMode('create');
  }

  function openEdit(lt: LeaveTypeDto): void {
    setName(lt.name);
    setAccrualDays(String(lt.accrualDays));
    setPaidLeave(lt.paidLeave);
    setEnforcement(lt.enforcement);
    setIsActive(lt.isActive);
    setFormError(null);
    setSavedMessage(null);
    setMode(lt);
  }

  function closeForm(): void {
    if (submitting) return;
    setMode(null);
    setFormError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (mode === null || submitting) return;
    const trimmedName = name.trim();
    const normalizedCode = code.trim().toUpperCase();
    if (!trimmedName) { setFormError('Name is required.'); return; }
    if (mode === 'create' && !normalizedCode) { setFormError('Code is required.'); return; }
    if (mode === 'create' && types.some((type) => type.code.toUpperCase() === normalizedCode)) {
      setFormError('A leave type with this code already exists.');
      return;
    }
    if (accrualDays.trim() === '') { setFormError('Enter annual accrual days.'); return; }
    const days = Number(accrualDays);
    if (!Number.isSafeInteger(days) || days < 0) {
      setFormError('Accrual days must be a non-negative whole number.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      let saved: LeaveTypeDto;
      if (mode === 'create') {
        saved = await createLeaveType({
          code: normalizedCode,
          name: trimmedName,
          kind,
          accrualDays: days,
          enforcement,
          paidLeave,
        });
        setLastCode(normalizedCode);
      } else {
        saved = await updateLeaveType(mode.id, {
          name: trimmedName,
          accrualDays: days,
          enforcement,
          paidLeave,
          isActive,
        });
      }
      setTypes((current) => [
        ...current.filter((type) => type.id !== saved.id),
        saved,
      ].sort((left, right) => left.name.localeCompare(right.name)));
      setMode(null);
      setError(null);
      setSavedMessage(mode === 'create' ? 'Leave type created.' : 'Leave type updated.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save leave type.');
    } finally {
      setSubmitting(false);
    }
  }

  const isCreate = mode === 'create';
  const isEdit = mode !== null && mode !== 'create';

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Leave types</h2>
          <p className="mt-1 text-sm text-app-muted">
            Set the types employees can request and their yearly accrual.
          </p>
        </div>
      {mode === null && !loading && !error && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent"
          >
            Add leave type
          </button>
        )}
      </div>

      {(isCreate || isEdit) && (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          aria-busy={submitting}
          className="rounded-2xl border border-app-border bg-app-surface p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold">
            {isCreate ? 'New leave type' : `Edit ${mode.name}`}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {isCreate && (
              <>
                <div>
                  <label htmlFor="leave-type-code" className="block text-xs font-semibold text-app-muted">Code</label>
                  <input
                    id="leave-type-code"
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="ANNUAL"
                    maxLength={50}
                    required
                    autoFocus
                    disabled={submitting}
                    className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm font-mono uppercase"
                  />
                  {code && <p className="mt-1 text-xs text-app-muted">Auto-generated — edit as needed.</p>}
                  <p className="mt-0.5 text-[10px] text-app-muted">Short unique identifier, e.g. ANNUAL, SICK</p>
                </div>
                <div>
                  <label htmlFor="leave-type-kind" className="block text-xs font-semibold text-app-muted">Kind</label>
                  <select
                    id="leave-type-kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as 'absence' | 'attendance-mode')}
                    disabled={submitting}
                    className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
                  >
                    <option value="absence">Absence</option>
                    <option value="attendance-mode">Attendance mode</option>
                  </select>
                  <p className="mt-0.5 text-[10px] text-app-muted">Absence = days off; Attendance mode = alternate work pattern</p>
                </div>
              </>
            )}
            <div>
              <label htmlFor="leave-type-name" className="block text-xs font-semibold text-app-muted">Name</label>
              <input
                id="leave-type-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Annual Leave"
                maxLength={100}
                required
                autoFocus={isEdit}
                disabled={submitting}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="leave-type-accrual" className="block text-xs font-semibold text-app-muted">Accrual days / year</label>
              <input
                id="leave-type-accrual"
                type="number"
                value={accrualDays}
                onChange={(e) => setAccrualDays(e.target.value)}
                min="0"
                step="1"
                required
                disabled={submitting}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
              <p className="mt-0.5 text-[10px] text-app-muted">Days per calendar year; someone joining mid-year gets a pro-rated share (0 = no balance)</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={paidLeave}
                onChange={(e) => setPaidLeave(e.target.checked)}
                disabled={submitting}
                className="h-4 w-4 rounded border-app-border accent-app-accent"
              />
              <span>Paid leave</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enforcement}
                onChange={(e) => setEnforcement(e.target.checked)}
                disabled={submitting}
                className="h-4 w-4 rounded border-app-border accent-app-accent"
              />
              <span>Limit requests to the balance</span>
            </label>
            {isEdit && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={submitting}
                  className="h-4 w-4 rounded border-app-border accent-app-accent"
                />
                <span>Active</span>
              </label>
            )}
          </div>
          <p className="text-xs text-app-muted">
            With the limit on, a request beyond the employee&apos;s remaining balance (after requests awaiting approval) is refused. HR can adjust a balance under Leave Balances. Existing requests remain in history when a type is made inactive.
          </p>
          {formError && <p role="alert" className="text-sm text-app-danger">{formError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-app-on-accent disabled:opacity-50"
            >
              {submitting ? (isCreate ? 'Creating…' : 'Saving…') : (isCreate ? 'Create' : 'Save changes')}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={submitting}
              className="rounded-lg border border-app-border px-4 py-2 text-sm text-app-muted hover:border-app-accent disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {savedMessage && <p role="status" className="text-sm text-app-success">{savedMessage}</p>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-app-danger">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-app-border px-3 py-1.5 text-app-foreground">
            Try again
          </button>
        </div>
      )}
      {loading && <SkeletonTable columns={4} rows={5} />}

      {!loading && !error && types.length === 0 && (
        <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted">
          No leave types yet. Add one to let employees apply for leave.
        </div>
      )}

      {!loading && !error && types.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-app-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Configured leave types and their availability</caption>
            <thead>
              <tr className="border-b border-app-border text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Code</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Name</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Kind</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Accrual / yr</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Paid</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Balance rule</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Status</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-app-muted">Action</th>
              </tr>
            </thead>
            <tbody>
              {types.map((lt) => (
                <tr key={lt.id} className="border-b border-app-border last:border-0 hover:bg-app-surface-raised">
                  <td className="px-4 py-3 font-mono text-xs">{lt.code}</td>
                  <td className="px-4 py-3 font-medium">{lt.name}</td>
                  <td className="px-4 py-3 text-app-muted capitalize">{lt.kind === 'attendance-mode' ? 'Attendance mode' : 'Absence'}</td>
                  <td className="px-4 py-3 tabular-nums text-app-muted">{lt.accrualDays} d</td>
                  <td className="px-4 py-3 text-app-muted">{lt.paidLeave ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-app-muted">{lt.enforcement ? 'Limited to balance' : 'No limit'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${lt.isActive ? 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200' : 'bg-app-surface-raised text-app-muted'}`}>
                      {lt.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(lt)}
                      className="rounded-lg border border-app-border px-2.5 py-1 text-xs text-app-muted hover:border-app-accent hover:text-app-foreground"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
