import { useEffect, useState } from 'react';
import {
  getCompanyDepartments,
  getCompanyEmployees,
  getCompanyIdentity,
  getCompanyLadder,
  getCompanyReportingManagers,
  type CompanyDepartment,
  type CompanyEmployee,
  type CompanyLadderPosition,
  type CompanyReportingManager,
} from '../../company/api/companyApi.js';
import { getRoleChangeRequestAccess, requestRoleChange } from '../api/accessApi.js';
import {
  Card,
  ErrorMessage,
  Field,
  Loading,
  Notice,
  Page,
  Select,
  Button,
} from '../../ui/components.js';

interface RolePosition {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
}
interface RoleTeam {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
}

export function RoleChangeRequestPage(): React.JSX.Element {
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [positions, setPositions] = useState<RolePosition[]>([]);
  const [teams, setTeams] = useState<RoleTeam[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [reportingManagerId, setReportingManagerId] = useState('');
  const [reportingManagers, setReportingManagers] = useState<CompanyReportingManager[]>([]);
  const [reportingManagersLoading, setReportingManagersLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);

  useEffect(() => {
    void Promise.all([
      getRoleChangeRequestAccess(),
      getCompanyIdentity(),
      getCompanyEmployees(),
      getCompanyDepartments(),
    ])
      .then(async ([, identity, employeeRows, departments]) => {
        setCurrentUserId(identity.user.id);
        setEmployees(employeeRows);
        const ladders = await Promise.all(
          departments.map((department) => getCompanyLadder(department.code)),
        );
        const flattened: RolePosition[] = [];
        const flattenedTeams: RoleTeam[] = [];
        const visit = (
          items: CompanyLadderPosition[],
          department: CompanyDepartment,
        ): void => {
          for (const position of items) {
            flattened.push({
              id: position.id,
              name: position.name,
              departmentId: department.id,
              departmentName: department.name,
            });
            visit(position.children ?? [], department);
          }
        };
        departments.forEach((department, index) => {
          visit(ladders[index]?.positions ?? [], department);
          for (const team of ladders[index]?.teams ?? []) {
            flattenedTeams.push({
              id: team.id,
              name: team.name,
              departmentId: department.id,
              departmentName: department.name,
            });
          }
        });
        setPositions(flattened);
        setTeams(flattenedTeams);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const selectedEmployee = employees.find((employee) => employee.id === employeeId);
  const selectedPosition = positions.find((position) => position.id === positionId);
  const availableTeams = selectedPosition
    ? teams.filter((team) => team.departmentId === selectedPosition.departmentId)
    : [];
  const selectableEmployees = employees.filter(
    (employee) => employee.id !== currentUserId,
  );

  useEffect(() => {
    const targetPosition = positions.find((position) => position.id === positionId);
    if (!employeeId || !targetPosition) {
      setReportingManagerId('');
      setReportingManagers([]);
      return;
    }
    setReportingManagersLoading(true);
    void getCompanyReportingManagers(
      targetPosition.departmentId,
      targetPosition.id,
      employeeId,
      selectedTeamId || undefined,
    )
      .then(setReportingManagers)
      .catch(() => setReportingManagers([]))
      .finally(() => setReportingManagersLoading(false));
  }, [employeeId, positionId, positions, selectedTeamId]);

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!employeeId || !positionId || !reason.trim()) return;
    setSubmitting(true);
    setMessage('');
    setMessageError(false);
    void requestRoleChange({
      subjectUserId: employeeId,
      toPositionId: positionId,
      requestedTeamId:
        availableTeams.some((team) => team.id === selectedTeamId) ? selectedTeamId : null,
      requestedReportsTo: reportingManagerId || null,
      reason,
    })
      .then(() => {
        setEmployeeId('');
        setPositionId('');
        setSelectedTeamId('');
        setReportingManagerId('');
        setReason('');
        setMessage('Position-change request submitted for Super Admin approval.');
      })
      .catch((cause: unknown) => {
        setMessageError(true);
        setMessage(
          cause instanceof Error
            ? cause.message
            : 'The position-change request was rejected.',
        );
      })
      .finally(() => setSubmitting(false));
  };

  if (error) {
    return (
      <Page eyebrow="Access Management" title="Request Role Change">
        <ErrorMessage cause={error} />
      </Page>
    );
  }

  return (
    <Page
      eyebrow="Access Management"
      title="Request Role Change"
      description="Request a position change for an employee. A Super Admin must review and approve the request before anything changes."
    >
      <Card className="mt-6">
        {loading ? (
          <Loading />
        ) : (
          <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
            <Select
              label="Employee"
              value={employeeId}
      onChange={(value) => {
        setEmployeeId(value);
        setPositionId('');
        setSelectedTeamId('');
              }}
              options={selectableEmployees.map((employee) => ({
                value: employee.id,
                label: `${employee.fullName} · ${employee.email ?? 'employee'}`,
              }))}
              required
              disabled={submitting}
            />
            <Field
              label="Current position"
              value={selectedEmployee?.positionName ?? 'No position assigned'}
              onChange={() => undefined}
              disabled
            />
            <Select
              label="Requested reporting manager (optional)"
              value={reportingManagerId}
              onChange={setReportingManagerId}
              options={reportingManagers.map((manager) => ({
                value: manager.id,
                label: `${manager.fullName} · ${manager.accountType}`,
              }))}
              disabled={submitting || reportingManagersLoading || !positionId}
            />
            {positionId && !reportingManagersLoading && reportingManagers.length === 0 ? (
              <p className="text-xs text-app-muted">
                No valid reporting manager is available for the requested position. Leaving
                this blank preserves the employee&apos;s current reporting manager.
              </p>
            ) : null}
            <Field
              label="Department"
              value={selectedEmployee?.departmentName ?? 'Not assigned'}
              onChange={() => undefined}
              disabled
            />
            <Field
              label="Team"
              value={selectedEmployee?.teamName ?? 'Not assigned'}
              onChange={() => undefined}
              disabled
            />
            <Field
              label="Reports to"
              value={selectedEmployee?.reportsToName ?? 'Not assigned'}
              onChange={() => undefined}
              disabled
            />
            <Select
              label="Requested position"
              value={positionId}
              onChange={(value) => {
                setPositionId(value);
                setSelectedTeamId('');
              }}
              options={positions.map((position) => ({
                value: position.id,
                label: `${position.name} · ${position.departmentName}`,
              }))}
              required
              disabled={submitting}
            />
            <Select
              label="Requested team (optional)"
              value={selectedTeamId}
              onChange={setSelectedTeamId}
              options={availableTeams.map((team) => ({
                value: team.id,
                label: `${team.name} · ${team.departmentName}`,
              }))}
              disabled={submitting || !positionId}
            />
            <Field
              label="Requested department"
              value={selectedPosition?.departmentName ?? 'Select a position'}
              onChange={() => undefined}
              disabled
            />
            <Field
              label="Reason"
              value={reason}
              onChange={setReason}
              placeholder="Explain why the position change is needed"
              required
              disabled={submitting}
            />
            <div className="flex items-end gap-3 md:col-span-2">
              <Button
                type="submit"
                disabled={submitting || !employeeId || !positionId || !reason.trim()}
              >
                {submitting ? 'Submitting…' : 'Submit request'}
              </Button>
              {message ? (
                <span
                  className={
                    messageError ? 'text-sm text-app-danger' : 'text-sm text-app-muted'
                  }
                >
                  {message}
                </span>
              ) : null}
            </div>
          </form>
        )}
        {!loading && selectableEmployees.length === 0 ? (
          <Notice error>
            No active employees are available for a position-change request.
          </Notice>
        ) : null}
      </Card>
    </Page>
  );
}
