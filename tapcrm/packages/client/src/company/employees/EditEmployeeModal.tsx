import { useEffect, useId, useMemo, useState } from 'react';
import {
  changePlacement,
  getEmployee,
  setEmployeeStatus,
  updateEmployee,
  type EmployeeProfile,
  type UpdateEmployeeInput,
} from '../api/employeesApi.js';
import {
  getCompanyLadder,
  getCompanyReportingManagers,
  type CompanyDepartment,
  type CompanyDesignation,
  type CompanyLadderPosition,
  type CompanyReportingManager,
  type CompanyTeam,
} from '../api/companyApi.js';
import {
  listShifts,
  getEmployeeShift,
  assignShiftToEmployee,
  type ShiftTemplate,
} from '../api/shiftsApi.js';
import { Button, Modal, Notice, SkeletonProfile } from '../../ui/components.js';

type Tab = 'profile' | 'placement' | 'shift' | 'account';

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function flattenPositions(positions: CompanyLadderPosition[], depth = 0): Array<{ value: string; label: string }> {
  return positions.flatMap((position) => [
    { value: position.id, label: `${'— '.repeat(depth)}${position.name}` },
    ...flattenPositions(position.children ?? [], depth + 1),
  ]);
}

const inputClass =
  'w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-60';

function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
}): React.JSX.Element {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xs font-semibold text-app-muted">{label}</label>
      <input id={id} type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      {hint && <p className="mt-1 text-xs text-app-muted">{hint}</p>}
    </div>
  );
}

function Choice({
  label,
  value,
  onChange,
  options,
  empty,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  empty: string;
  disabled?: boolean;
}): React.JSX.Element {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xs font-semibold text-app-muted">{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">{empty}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

export function EditEmployeeModal({
  userId,
  departments,
  teams,
  designations,
  isSuperAdmin,
  canRequestRoleChange,
  onClose,
  onSaved,
  onRequestRoleChange,
}: {
  userId: string;
  departments: CompanyDepartment[];
  teams: CompanyTeam[];
  designations: CompanyDesignation[];
  isSuperAdmin: boolean;
  canRequestRoleChange: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onRequestRoleChange?: () => void;
}): React.JSX.Element {
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Profile form
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [teamId, setTeamId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [leavingDate, setLeavingDate] = useState('');

  // Placement form (Super Admin)
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [placementTeamId, setPlacementTeamId] = useState('');
  const [reportsTo, setReportsTo] = useState('');
  const [placementReason, setPlacementReason] = useState('');
  const [positions, setPositions] = useState<Array<{ value: string; label: string }>>([]);
  const [rootPositionIds, setRootPositionIds] = useState<Set<string>>(new Set());
  const [managers, setManagers] = useState<CompanyReportingManager[]>([]);

  // Shift
  const [shifts, setShifts] = useState<ShiftTemplate[]>([]);
  const [currentShiftId, setCurrentShiftId] = useState<string | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [shiftEffectiveFrom, setShiftEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));

  // Account
  const [statusReason, setStatusReason] = useState('');

  function fill(next: EmployeeProfile): void {
    setProfile(next);
    setFullName(next.fullName);
    setEmail(next.email ?? '');
    setEmployeeCode(next.employeeId ?? '');
    setTeamId(next.teamId ?? '');
    setDesignationId(next.designationId ?? '');
    setSpecialization(next.specialization ?? '');
    setJoiningDate(next.joinedOn ?? '');
    setLeavingDate(next.leftOn ?? '');
    setDepartmentId(next.departmentId ?? '');
    setPositionId(next.positionId ?? '');
    setPlacementTeamId(next.teamId ?? '');
    setReportsTo(next.reportsTo ?? '');
  }

  useEffect(() => {
    getEmployee(userId).then(fill).catch((err: unknown) => setError(errorText(err, 'Unable to load the employee.')));
    listShifts()
      .then((all) => setShifts(all.filter((s) => s.status === 'active')))
      .catch(() => undefined);
    getEmployeeShift(userId)
      .then(({ days }) => {
        const today = days[0];
        const id = today?.shiftId ?? null;
        setCurrentShiftId(id);
        setSelectedShiftId(id ?? '');
      })
      .catch(() => undefined);
  }, [userId]);

  // Positions for the chosen department.
  useEffect(() => {
    const department = departments.find((d) => d.id === departmentId);
    if (!department) {
      setPositions([]);
      return;
    }
    getCompanyLadder(department.code)
      .then((ladder) => {
        setPositions(flattenPositions(ladder.positions));
        setRootPositionIds(new Set(ladder.positions.map((p) => p.id)));
      })
      .catch(() => setError('Unable to load positions for this department.'));
  }, [departmentId, departments]);

  // Managers valid for the chosen placement.
  useEffect(() => {
    if (!departmentId || !positionId || rootPositionIds.has(positionId)) {
      setManagers([]);
      return;
    }
    getCompanyReportingManagers(departmentId, positionId, userId, placementTeamId || undefined)
      .then(setManagers)
      .catch(() => setError('Unable to load reporting managers.'));
  }, [departmentId, positionId, placementTeamId, rootPositionIds, userId]);

  const departmentTeams = useMemo(() => teams.filter((t) => t.departmentId === profile?.departmentId), [teams, profile]);
  const placementTeams = useMemo(() => teams.filter((t) => t.departmentId === departmentId), [teams, departmentId]);
  const departmentDesignations = designations.filter((d) => d.departmentId === profile?.departmentId || d.id === profile?.designationId);
  const designation = designations.find((d) => d.id === designationId);

  async function saveProfile(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!profile) return;
    const changes: UpdateEmployeeInput = {};
    if (fullName.trim() !== profile.fullName) changes.fullName = fullName.trim();
    if (email.trim().toLowerCase() !== (profile.email ?? '').toLowerCase()) changes.email = email.trim();
    if (employeeCode.trim().toUpperCase() !== (profile.employeeId ?? '')) changes.employeeId = employeeCode.trim();
    if ((teamId || null) !== profile.teamId) changes.teamId = teamId || null;
    if ((designationId || null) !== profile.designationId) changes.designationId = designationId || null;
    if ((specialization || null) !== profile.specialization) changes.specialization = specialization || null;
    if ((joiningDate || null) !== profile.joinedOn) changes.joiningDate = joiningDate || null;
    if ((leavingDate || null) !== profile.leftOn) changes.leavingDate = leavingDate || null;
    if (Object.keys(changes).length === 0) {
      setNotice('Nothing has changed.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateEmployee(userId, changes);
      fill(result);
      const cleared = result.reportingLinesCleared.length;
      onSaved(`${result.fullName}'s details saved.${cleared ? ` ${cleared} reporting line(s) no longer valid after the team change were reset to the position tree.` : ''}`);
    } catch (err) {
      setError(errorText(err, 'Unable to save the changes.'));
    } finally {
      setBusy(false);
    }
  }

  async function savePlacement(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await changePlacement(userId, {
        departmentId,
        positionId,
        teamId: placementTeamId || null,
        reportsTo: rootPositionIds.has(positionId) ? null : reportsTo || null,
        ...(placementReason.trim() ? { reason: placementReason.trim() } : {}),
      });
      fill(result);
      const parts = [`${result.fullName} is now ${result.positionName ?? 'placed'} in ${result.departmentName ?? 'the department'}.`];
      if (result.reportingLinesCleared.length) parts.push(`${result.reportingLinesCleared.length} reporting line(s) that no longer fit were reset.`);
      if (result.overridesCleared) parts.push(`${result.overridesCleared} personal permission override(s) ended with the old position.`);
      parts.push('Their open sessions end so the new permissions apply at next sign-in.');
      onSaved(parts.join(' '));
    } catch (err) {
      setError(errorText(err, 'Unable to change the position.'));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(next: 'active' | 'inactive'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await setEmployeeStatus(userId, next, statusReason.trim());
      fill(result);
      setStatusReason('');
      onSaved(next === 'inactive'
        ? `${result.fullName} can no longer sign in. Their sessions have ended.`
        : `${result.fullName} can sign in again.`);
    } catch (err) {
      setError(errorText(err, 'Unable to change the account status.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveShift(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedShiftId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await assignShiftToEmployee({
        kind: 'template',
        userId,
        shiftId: selectedShiftId,
        effectiveFrom: shiftEffectiveFrom,
      });
      setCurrentShiftId(selectedShiftId);
      const shift = shifts.find((s) => s.id === selectedShiftId);
      onSaved(`Shift changed to ${shift?.name ?? 'selected shift'} effective ${shiftEffectiveFrom}.`);
    } catch (err) {
      setError(errorText(err, 'Unable to save the shift.'));
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'profile', label: 'Details' },
    { key: 'placement', label: 'Position & manager' },
    { key: 'shift', label: 'Shift' },
    { key: 'account', label: 'Account' },
  ];

  return (
    <Modal title={profile ? `Edit ${profile.fullName}` : 'Edit employee'} onClose={onClose}>
      {!profile && !error && <SkeletonProfile />}
      {profile && (
        <div className="space-y-4">
          <div className="flex gap-1 rounded-lg border border-app-border p-1" role="tablist">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => { setTab(item.key); setError(null); setNotice(null); }}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold ${tab === item.key ? 'bg-app-accent text-app-on-accent' : 'text-app-muted hover:text-app-foreground'}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'profile' && (
            <form onSubmit={(e) => void saveProfile(e)} className="grid gap-4 md:grid-cols-2">
              <TextInput label="Full name" value={fullName} onChange={setFullName} required />
              <TextInput label="Login email" type="email" value={email} onChange={setEmail} required hint="They sign in with this address." />
              <TextInput label="Employee ID" value={employeeCode} onChange={(v) => setEmployeeCode(v.toUpperCase())} required />
              <Choice
                label="Team"
                value={teamId}
                onChange={setTeamId}
                options={departmentTeams.map((t) => ({ value: t.id, label: t.name }))}
                empty="No team"
              />
              <Choice
                label="Designation"
                value={designationId}
                onChange={(v) => { setDesignationId(v); setSpecialization(''); }}
                options={departmentDesignations.map((d) => ({ value: d.id, label: d.name }))}
                empty="No designation"
              />
              {designation && designation.specializations.length > 0 ? (
                <Choice
                  label="Specialization"
                  value={specialization}
                  onChange={setSpecialization}
                  options={designation.specializations.map((s) => ({ value: s, label: s }))}
                  empty="None"
                />
              ) : <div />}
              <TextInput label="Joining date" type="date" value={joiningDate} onChange={setJoiningDate} />
              <TextInput
                label="Leaving date"
                type="date"
                value={leavingDate}
                onChange={setLeavingDate}
                hint="Their last working day. Attendance and pay stop after it."
              />
              {error && <div className="md:col-span-2"><Notice error>{error}</Notice></div>}
              {notice && <div className="md:col-span-2"><Notice>{notice}</Notice></div>}
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button kind="secondary" onClick={onClose}>Close</Button>
                <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</Button>
              </div>
            </form>
          )}

          {tab === 'placement' && (
            isSuperAdmin ? (
              <form onSubmit={(e) => void savePlacement(e)} className="grid gap-4 md:grid-cols-2">
                <Choice
                  label="Department"
                  value={departmentId}
                  onChange={(v) => { setDepartmentId(v); setPositionId(''); setPlacementTeamId(''); setReportsTo(''); }}
                  options={departments.map((d) => ({ value: d.id, label: d.name }))}
                  empty="Select department"
                />
                <Choice
                  label="Position"
                  value={positionId}
                  onChange={(v) => { setPositionId(v); setReportsTo(''); }}
                  options={positions}
                  empty={positions.length === 0 ? 'No positions in this department' : 'Select position'}
                />
                <Choice
                  label="Team"
                  value={placementTeamId}
                  onChange={(v) => { setPlacementTeamId(v); setReportsTo(''); }}
                  options={placementTeams.map((t) => ({ value: t.id, label: t.name }))}
                  empty="No team"
                />
                {rootPositionIds.has(positionId) ? (
                  <p className="self-end text-xs text-app-muted">This is the department&apos;s top position; it reports to the Super Admin.</p>
                ) : (
                  <Choice
                    label="Reports to"
                    value={reportsTo}
                    onChange={setReportsTo}
                    options={managers.map((m) => ({ value: m.id, label: m.accountType === 'super-admin' ? `${m.fullName} (Super Admin)` : m.fullName }))}
                    empty="Whoever holds the position above"
                  />
                )}
                <div className="md:col-span-2">
                  <TextInput label="Reason (kept in the audit log)" value={placementReason} onChange={setPlacementReason} />
                </div>
                <p className="text-xs text-app-muted md:col-span-2">
                  Changing the position changes their permissions. Reporting lines the move breaks — theirs or their team&apos;s — are reset to the position tree.
                </p>
                {error && <div className="md:col-span-2"><Notice error>{error}</Notice></div>}
                <div className="flex justify-end gap-2 md:col-span-2">
                  <Button kind="secondary" onClick={onClose}>Close</Button>
                  <Button type="submit" disabled={busy || !departmentId || !positionId}>{busy ? 'Saving…' : 'Change position'}</Button>
                </div>
              </form>
            ) : (
              <div className="space-y-3 text-sm">
                <p><span className="text-app-muted">Department:</span> {profile.departmentName ?? '—'}</p>
                <p><span className="text-app-muted">Position:</span> {profile.positionName ?? '—'}</p>
                <p><span className="text-app-muted">Reports to:</span> {profile.reportsToName ?? 'Whoever holds the position above'}</p>
                <Notice>
                  Only the Super Admin changes positions directly.
                  {canRequestRoleChange ? ' You can request a position change for the Super Admin to approve.' : ''}
                </Notice>
                {canRequestRoleChange && onRequestRoleChange && (
                  <Button onClick={onRequestRoleChange}>Request a position change</Button>
                )}
              </div>
            )
          )}

          {tab === 'shift' && (
            <form onSubmit={(e) => void saveShift(e)} className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2 text-sm text-app-muted">
                {currentShiftId
                  ? <>Current shift: <span className="font-semibold text-app-foreground">{shifts.find((s) => s.id === currentShiftId)?.name ?? currentShiftId}</span></>
                  : 'No shift is currently assigned to this employee.'
                }
              </div>
              <Choice
                label="New shift"
                value={selectedShiftId}
                onChange={setSelectedShiftId}
                options={shifts.map((s) => ({ value: s.id, label: `${s.name} (${s.kind})` }))}
                empty="Select a shift"
              />
              <div>
                <label className="mb-2 block text-xs font-semibold text-app-muted">Effective from</label>
                <input
                  type="date"
                  value={shiftEffectiveFrom}
                  onChange={(e) => setShiftEffectiveFrom(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
                  required
                />
              </div>
              <p className="text-xs text-app-muted md:col-span-2">
                Assigning a shift from this date replaces any existing template assignment. Choose a future date to schedule the change without affecting past attendance.
              </p>
              {error && <div className="md:col-span-2"><Notice error>{error}</Notice></div>}
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button kind="secondary" onClick={onClose}>Close</Button>
                <Button type="submit" disabled={busy || !selectedShiftId}>{busy ? 'Saving…' : 'Assign shift'}</Button>
              </div>
            </form>
          )}

          {tab === 'account' && (
            <div className="space-y-4">
              <p className="text-sm">
                Status: <span className="font-semibold">{profile.status === 'active' ? 'Active' : profile.status === 'locked' ? 'Locked (too many sign-in attempts)' : profile.status === 'inactive' ? 'Deactivated' : 'Offboarded'}</span>
              </p>
              {profile.status !== 'offboarded' && (
                <>
                  <TextInput label="Reason" value={statusReason} onChange={setStatusReason} />
                  {error && <Notice error>{error}</Notice>}
                  {profile.status === 'inactive' ? (
                    <Button disabled={busy || statusReason.trim() === ''} onClick={() => void changeStatus('active')}>Reactivate sign-in</Button>
                  ) : (
                    <Button kind="danger" disabled={busy || statusReason.trim() === ''} onClick={() => void changeStatus('inactive')}>Deactivate sign-in</Button>
                  )}
                  <p className="text-xs text-app-muted">
                    Deactivating ends their sessions and blocks sign-in. To stop attendance and pay, also set a leaving date under Details.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {!profile && error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
