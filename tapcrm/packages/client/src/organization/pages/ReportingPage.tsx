import { useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon.js';
import { WorkspacePageContainer } from '../../ui/components.js';
import { organizationApi } from '../api/organizationApi.js';
import {
  Button,
  Card,
  Empty,
  ErrorMessage,
  SkeletonTable,
  Modal,
  Notice,
  Select,
} from '../components/OrganizationUi.js';
import type {
  OrganizationChart,
  ReportingManagerCandidate,
  ReportingPreview,
} from '../types/index.js';

export function ReportingPage(): React.JSX.Element {
  const [chart, setChart] = useState<OrganizationChart | null>(null);
  const [userId, setUserId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [candidates, setCandidates] = useState<ReportingManagerCandidate[]>([]);
  const [mode, setMode] = useState<'individual' | 'subtree'>('individual');
  const [preview, setPreview] = useState<ReportingPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  async function load() {
    setLoading(true);
    try {
      setChart(await organizationApi.chart());
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const employees = chart?.people ?? [];
  const selected = employees.find((employee) => employee.id === userId);
  useEffect(() => {
    if (!selected?.departmentId || !selected.positionId) {
      setCandidates([]);
      return;
    }
    void organizationApi
      .reportingManagers(
        selected.departmentId,
        selected.positionId,
        selected.id,
        selected.teamId ?? undefined,
      )
      .then(setCandidates)
      .catch(setError);
  }, [selected?.departmentId, selected?.positionId, selected?.teamId, selected?.id]);
  async function previewChange(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await organizationApi.previewManagerReassignment(userId, managerId || null, mode),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    try {
      if (mode === 'subtree')
        await organizationApi.confirmSubtreeReassignment(userId, managerId || null);
      else await organizationApi.reassignManager(userId, managerId || null);
      setPreview(null);
      setMessage('Reporting relationship updated.');
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspacePageContainer>
      {message && (
        <div className="mt-5">
          <Notice>{message}</Notice>
        </div>
      )}
      {Boolean(error) && (
        <div className="mt-5">
          <ErrorMessage cause={error} />
        </div>
      )}
      {loading ? (
        <SkeletonTable columns={4} rows={5} />
      ) : employees.length === 0 ? (
        <Empty>No employee reporting data is visible.</Empty>
      ) : (
        <div className="mt-5 space-y-5">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center gap-3 border-b border-b-[color:var(--app-border)] px-5 py-4 sm:px-6">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-app-accent/10 text-app-accent"><Icon name="users" className="size-4" /></span>
              <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-app-muted">Organization</p><h1 className="mt-0.5 text-base font-bold">Reporting relationships</h1><p className="mt-0.5 text-xs text-app-muted">Preview a backend-validated individual or subtree reassignment before applying it.</p></div>
            </div>
            <form
              onSubmit={(event) => {
                void previewChange(event);
              }}
              className="grid gap-4 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
            >
              <Select
                label="Employee"
                value={userId}
                onChange={(value) => {
                  setUserId(value);
                  setManagerId('');
                }}
                options={employees.map((employee) => ({
                  value: employee.id,
                  label: employee.fullName,
                }))}
                required
              />
              <Select
                label="New manager"
                value={managerId}
                onChange={setManagerId}
                options={candidates.map((employee) => ({
                  value: employee.id,
                  label:
                    employee.accountType === 'super-admin'
                      ? `${employee.fullName} (Company Super Admin)`
                      : employee.fullName,
                }))}
              />
              <Select
                label="Operation"
                value={mode}
                onChange={(value) => setMode(value as 'individual' | 'subtree')}
                options={[
                  { value: 'individual', label: 'Individual' },
                  { value: 'subtree', label: 'Subtree — move reports too' },
                ]}
              />
              <Button type="submit" disabled={busy || !userId}>
                {busy ? 'Preparing…' : 'Preview change'}
              </Button>
            </form>
          </Card>
          <Card className="overflow-hidden p-0">
            <div className="border-b border-b-[color:var(--app-border)] px-5 py-4 sm:px-6"><h2 className="text-base font-bold">Visible reporting lines</h2><p className="mt-0.5 text-xs text-app-muted">Current explicit and effective reporting relationships.</p></div>
            <div className="divide-y divide-app-border px-5 sm:px-6">
              {employees.map((employee) => (
                <div
                  key={employee.id}
                  className="flex flex-wrap justify-between gap-2 py-3"
                >
                  <span className="font-semibold">{employee.fullName}</span>
                  <span className="text-sm text-app-muted">
                    Explicit manager:{' '}
                    {employees.find((candidate) => candidate.id === employee.reportsTo)
                      ?.fullName ?? (employee.reportsTo ? 'Unavailable' : 'None')}
                    {' · Effective manager: '}
                    {employee.reportsToName ?? 'None'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      {preview && (
        <Modal
          title={
            mode === 'subtree'
              ? 'Confirm subtree reassignment'
              : 'Confirm manager reassignment'
          }
          onClose={() => setPreview(null)}
        >
          <p className="text-sm text-app-muted">
            {mode === 'subtree'
              ? 'Every affected employee listed below will receive the proposed manager.'
              : 'Only the selected employee will change.'}
          </p>
          <div className="mt-4 space-y-2">
            <div className="rounded-lg border border-app-border p-3 text-sm">
              <p>
                <strong>Current explicit manager:</strong>{' '}
                {selected?.reportsTo
                  ? (employees.find((employee) => employee.id === selected.reportsTo)
                      ?.fullName ?? 'Unavailable')
                  : 'None'}
              </p>
              <p className="mt-1">
                <strong>Current effective manager:</strong>{' '}
                {preview.currentManager?.fullName ?? selected?.reportsToName ?? 'None'}
              </p>
              <p className="mt-1">
                <strong>Proposed manager:</strong>{' '}
                {preview.proposedManager?.fullName ??
                  (managerId
                    ? (candidates.find((candidate) => candidate.id === managerId)
                        ?.fullName ?? 'Unavailable')
                    : 'None / root fallback')}
              </p>
            </div>
            {preview.affectedUsers.map((line) => (
              <div
                key={line.userId}
                className="rounded-lg border border-app-border p-3 text-sm"
              >
                <strong>
                  {employees.find((employee) => employee.id === line.userId)?.fullName ??
                    line.userId}
                </strong>
                <span className="text-app-muted">
                  {' '}
                  · {line.currentManagerId ?? 'None'} → {line.proposedManagerId ?? 'None'}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <Button
              onClick={() => {
                void confirm();
              }}
              disabled={busy}
            >
              {busy ? 'Applying…' : 'Confirm and apply'}
            </Button>
          </div>
        </Modal>
      )}
    </WorkspacePageContainer>
  );
}
