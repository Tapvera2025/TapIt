import { useEffect, useState } from 'react';
import { organizationApi } from '../api/organizationApi.js';
import {
  Button,
  Card,
  Empty,
  ErrorMessage,
  Loading,
  Modal,
  Notice,
  Select,
  Page,
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
    <Page
      eyebrow="Organization"
      title="Reporting"
      description="Review reporting relationships and use the backend-validated individual or subtree reassignment flow."
    >
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
        <Loading />
      ) : employees.length === 0 ? (
        <Empty>No employee reporting data is visible.</Empty>
      ) : (
        <>
          <Card className="mt-6">
            <form
              onSubmit={(event) => {
                void previewChange(event);
              }}
              className="grid gap-4 md:grid-cols-3"
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
          <Card className="mt-6">
            <h2 className="font-display text-xl font-bold">Visible reporting lines</h2>
            <div className="mt-4 divide-y divide-app-border">
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
        </>
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
    </Page>
  );
}
