import { useEffect, useMemo, useState } from 'react';
import {
  ACTIONS,
  REGISTRY,
  moduleTitle,
  type Action,
  type ModuleName,
  type Scope,
} from '@tapcrm/contracts';
import { getCompanyEmployees, getCompanyIdentity } from '../../company/api/companyApi.js';
import {
  navigationScreensByAction,
  navigationScreensForActions,
} from '../../company/layout/navigation.js';
import {
  getCapabilityHolders,
  getDelegationOptions,
  getEffectiveAccess,
  grantAccessOverride,
  getOverrideOverview,
  revokeAccessOverride,
  decideRoleChange,
  getRoleChangeRequests,
  type AccessPerson,
  type AccessPolicyRow,
  type CapabilityHolder,
  type DelegationOption,
  type EffectiveAccessResponse,
  type OverrideOverviewItem,
  type RoleChangeRequest,
} from '../api/accessApi.js';
import {
  Card,
  Button,
  ErrorMessage,
  Field,
  Loading,
  Notice,
  Page,
  Select,
} from '../../ui/components.js';

type ExplorerTab = 'person' | 'capability' | 'overrides' | 'role-changes';

export function AccessExplorerPage(): React.JSX.Element {
  const [tab, setTab] = useState<ExplorerTab>('person');
  const [people, setPeople] = useState<AccessPerson[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedAction, setSelectedAction] = useState<Action>('payroll:view');
  const [personResult, setPersonResult] = useState<EffectiveAccessResponse | null>(null);
  const [holders, setHolders] = useState<CapabilityHolder[]>([]);
  const [overrides, setOverrides] = useState<OverrideOverviewItem[]>([]);
  const [delegationOptions, setDelegationOptions] = useState<DelegationOption[]>([]);
  const [grantAction, setGrantAction] = useState<Action>('payroll:view');
  const [grantAllowed, setGrantAllowed] = useState(true);
  const [grantScope, setGrantScope] = useState<Scope>('own');
  const [grantReason, setGrantReason] = useState('');
  const [grantExpiry, setGrantExpiry] = useState('');
  const [narrowFields, setNarrowFields] = useState(false);
  const [grantFields, setGrantFields] = useState<string[]>([]);
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantMessage, setGrantMessage] = useState('');
  const [grantError, setGrantError] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState('');
  const [reviewError, setReviewError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [accessViewError, setAccessViewError] = useState<unknown>(null);
  const [canViewAccess, setCanViewAccess] = useState(false);
  const [roleRequests, setRoleRequests] = useState<RoleChangeRequest[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<unknown>(null);
  const [roleMessage, setRoleMessage] = useState('');
  const [roleMessageError, setRoleMessageError] = useState(false);
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);

  useEffect(() => {
    void getCompanyIdentity()
      .then((identity) => {
        const current: AccessPerson = {
          id: identity.user.id,
          fullName: identity.user.fullName,
          email: identity.user.email,
          accountType: identity.user.accountType as AccessPerson['accountType'],
          position: null,
          department: null,
          team: null,
          reportsTo: null,
        };
        setPeople([current]);
        setSelectedUserId(current.id);
        return getCompanyEmployees()
          .then((employees) => {
            const employeeOptions: AccessPerson[] = employees.map((person) => ({
              id: person.id,
              fullName: person.fullName,
              email: person.email ?? null,
              accountType: 'employee',
              position: person.positionId
                ? { id: person.positionId, name: person.positionName ?? null }
                : null,
              department: person.departmentId
                ? { id: person.departmentId, name: person.departmentName ?? null }
                : null,
              team: person.teamId
                ? { id: person.teamId, name: person.teamName ?? null }
                : null,
              reportsTo: person.reportsTo
                ? { id: person.reportsTo, name: person.reportsToName ?? null }
                : null,
            }));
            setPeople(
              employeeOptions.some((person) => person.id === current.id)
                ? employeeOptions
                : [current, ...employeeOptions],
            );
          })
          .catch(() => undefined);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab !== 'person' || !selectedUserId) return;
    setLoading(true);
    setAccessViewError(null);
    void getEffectiveAccess(selectedUserId)
      .then((result) => {
        setCanViewAccess(true);
        setPersonResult(result);
      })
      .catch((cause: unknown) => {
        setCanViewAccess(false);
        setAccessViewError(cause);
      })
      .finally(() => setLoading(false));
  }, [selectedUserId, tab]);

  useEffect(() => {
    if (tab !== 'capability') return;
    setLoading(true);
    void getCapabilityHolders(selectedAction)
      .then((result) => setHolders(result.holders))
      .catch(setError)
      .finally(() => setLoading(false));
  }, [selectedAction, tab]);

  useEffect(() => {
    if (tab !== 'role-changes') return;
    setRoleLoading(true);
    setRoleError(null);
    void getRoleChangeRequests('pending')
      .then((result) => setRoleRequests(result.requests))
      .catch(setRoleError)
      .finally(() => setRoleLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'overrides') return;
    setLoading(true);
    void Promise.all([
      getOverrideOverview().then((result) => setOverrides(result.overrides)),
      selectedUserId
        ? getDelegationOptions(selectedUserId).then((result) =>
            setDelegationOptions(result.options),
          )
        : Promise.resolve(),
    ])
      .catch(setError)
      .finally(() => setLoading(false));
  }, [selectedUserId, tab]);

  const selectedDelegationOption = delegationOptions.find(
    (option) => option.action === grantAction,
  );
  useEffect(() => {
    const nextScope = selectedDelegationOption?.scopes[0];
    if (
      nextScope !== undefined &&
      !selectedDelegationOption?.scopes.includes(grantScope)
    ) {
      setGrantScope(nextScope);
    }
  }, [grantScope, selectedDelegationOption]);

  useEffect(() => {
    setNarrowFields(false);
    setGrantFields(
      selectedDelegationOption?.fields ? [...selectedDelegationOption.fields] : [],
    );
  }, [selectedDelegationOption]);

  const handleRevoke = (overrideId: string): void => {
    if (!window.confirm('Revoke this override? The change will be audited.')) return;
    setRevokingId(overrideId);
    setReviewMessage('');
    setReviewError(false);
    void revokeAccessOverride(overrideId)
      .then(() => {
        setOverrides((current) =>
          current.filter((override) => override.id !== overrideId),
        );
        setReviewMessage('Override revoked and audited.');
      })
      .catch((cause: unknown) => {
        setReviewError(true);
        setReviewMessage(
          cause instanceof Error ? cause.message : 'Override could not be revoked.',
        );
      })
      .finally(() => setRevokingId(null));
  };

  const reachableScreens = useMemo(() => {
    if (!personResult) return [];
    return navigationScreensForActions(new Set(personResult.reachableActions));
  }, [personResult]);
  const screensByAction = useMemo(() => navigationScreensByAction(), []);

  if (error) {
    return (
      <Page eyebrow="Access Management" title="Access Explorer">
        <ErrorMessage cause={error} />
      </Page>
    );
  }

  return (
    <Page
      eyebrow="Access Management"
      title="Access Explorer"
      description="Inspect effective access from the same position-policy, override, and reporting resolution used by authorization."
    >
      <div className="mt-6 flex gap-2 border-b border-app-border">
        {canViewAccess ? (
          <button
            type="button"
            className={`border-b-2 px-4 py-3 text-sm font-bold ${tab === 'person' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted'}`}
            onClick={() => setTab('person')}
          >
            Person
          </button>
        ) : null}
        <button
          type="button"
          className={`border-b-2 px-4 py-3 text-sm font-bold ${tab === 'role-changes' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted'}`}
          onClick={() => setTab('role-changes')}
        >
          Role changes
        </button>
        {canViewAccess ? (
          <button
            type="button"
            className={`border-b-2 px-4 py-3 text-sm font-bold ${tab === 'capability' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted'}`}
            onClick={() => setTab('capability')}
          >
            Capability
          </button>
        ) : null}
        {canViewAccess ? (
          <button
            type="button"
            className={`border-b-2 px-4 py-3 text-sm font-bold ${tab === 'overrides' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted'}`}
            onClick={() => setTab('overrides')}
          >
            Override review
          </button>
        ) : null}
      </div>

      {tab === 'person' ? (
        <>
          <Card className="mt-6">
            <Select
              label="Person"
              value={selectedUserId}
              onChange={setSelectedUserId}
              options={people.map((person) => ({
                value: person.id,
                label: `${person.fullName} · ${person.email ?? person.accountType}`,
              }))}
            />
          </Card>
          {loading ? (
            <Loading />
          ) : accessViewError ? (
            <Notice error>
              Access Explorer details are not available for this account. Use Role changes
              if you have request access.
            </Notice>
          ) : personResult ? (
            <PersonResult
              result={personResult}
              reachableScreens={reachableScreens}
              screensByAction={screensByAction}
            />
          ) : null}
        </>
      ) : tab === 'capability' ? (
        <>
          <Card className="mt-6">
            <Select
              label="Capability"
              value={selectedAction}
              onChange={(value) => setSelectedAction(value as Action)}
              options={ACTIONS.map((action) => ({
                value: action,
                label: `${action} · ${moduleTitle(REGISTRY[action].module)}`,
              }))}
            />
          </Card>
          {loading ? (
            <Loading />
          ) : (
            <CapabilityResult action={selectedAction} holders={holders} />
          )}
        </>
      ) : tab === 'overrides' ? (
        <>
          {loading ? (
            <Loading />
          ) : (
            <OverrideOverviewResult
              overrides={overrides}
              onRevoke={handleRevoke}
              revokingId={revokingId}
              message={reviewMessage}
              messageError={reviewError}
            />
          )}
          {!loading ? (
            <DelegationPanel
              people={people}
              selectedUserId={selectedUserId}
              onTargetChange={setSelectedUserId}
              options={delegationOptions}
              selectedAction={grantAction}
              onActionChange={setGrantAction}
              allowed={grantAllowed}
              onAllowedChange={setGrantAllowed}
              selectedScope={grantScope}
              onScopeChange={setGrantScope}
              reason={grantReason}
              onReasonChange={setGrantReason}
              expiry={grantExpiry}
              onExpiryChange={setGrantExpiry}
              narrowFields={narrowFields}
              onNarrowFieldsChange={setNarrowFields}
              fields={grantFields}
              onFieldsChange={setGrantFields}
              busy={grantBusy}
              message={grantMessage}
              messageError={grantError}
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  !selectedUserId ||
                  !selectedDelegationOption?.canGrant ||
                  !grantReason.trim()
                )
                  return;
                setGrantBusy(true);
                setGrantMessage('');
                setGrantError(false);
                void grantAccessOverride({
                  userId: selectedUserId,
                  action: grantAction,
                  allowed: grantAllowed,
                  scope: grantScope,
                  fields: narrowFields ? grantFields : null,
                  reason: grantReason,
                  expiresAt: grantExpiry ? new Date(grantExpiry).toISOString() : null,
                })
                  .then(() => {
                    setGrantReason('');
                    setGrantExpiry('');
                    setGrantMessage('Override granted and audited.');
                  })
                  .catch((cause: unknown) => {
                    setGrantError(true);
                    setGrantMessage(
                      cause instanceof Error ? cause.message : 'Override was rejected.',
                    );
                  })
                  .finally(() => {
                    setGrantBusy(false);
                  });
              }}
            />
          ) : null}
        </>
      ) : (
        <RoleChangeReviewPanel
          requests={roleRequests}
          loading={roleLoading}
          error={roleError}
          message={roleMessage}
          messageError={roleMessageError}
          decisionReasons={decisionReasons}
          onDecisionReasonChange={(id, value) =>
            setDecisionReasons((current) => ({ ...current, [id]: value }))
          }
          decisionBusyId={decisionBusyId}
          people={people}
          onDecision={(request, approved) => {
            const reason = decisionReasons[request.id]?.trim() ?? '';
            if (
              !reason ||
              !window.confirm(
                `${approved ? 'Approve' : 'Reject'} this position-change request?`,
              )
            )
              return;
            setDecisionBusyId(request.id);
            setRoleMessage('');
            setRoleMessageError(false);
            void decideRoleChange(request.id, { approved, reason })
              .then(() => {
                setRoleRequests((current) =>
                  current.filter((item) => item.id !== request.id),
                );
                setRoleMessage(
                  `Request ${approved ? 'approved' : 'rejected'} and audited.`,
                );
              })
              .catch((cause: unknown) => {
                setRoleMessageError(true);
                setRoleMessage(
                  cause instanceof Error ? cause.message : 'The request decision failed.',
                );
              })
              .finally(() => setDecisionBusyId(null));
          }}
        />
      )}
    </Page>
  );
}

function RoleChangeReviewPanel({
  requests,
  people,
  loading,
  error,
  message,
  messageError,
  decisionReasons,
  onDecisionReasonChange,
  decisionBusyId,
  onDecision,
}: {
  requests: RoleChangeRequest[];
  people: AccessPerson[];
  loading: boolean;
  error: unknown;
  message: string;
  messageError: boolean;
  decisionReasons: Record<string, string>;
  onDecisionReasonChange: (id: string, value: string) => void;
  decisionBusyId: string | null;
  onDecision: (request: RoleChangeRequest, approved: boolean) => void;
}): React.JSX.Element {
  return (
    <Card className="mt-6">
      <h2 className="font-display text-xl font-bold">Pending position-change requests</h2>
      {message ? <Notice error={messageError}>{message}</Notice> : null}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage cause={error} />
      ) : requests.length === 0 ? (
        <p className="mt-4 text-sm text-app-muted">There are no pending requests.</p>
      ) : null}
      {!loading && !error ? (
        <div className="mt-4 space-y-4">
          {requests.map((request) => (
            <div
              key={request.id}
              className="rounded-lg border border-app-border p-4 text-sm"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{request.subject.fullName}</span>
                <span className="text-xs text-app-muted">
                  {new Date(request.requestedAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-2">
                {request.fromPosition?.name ?? 'No position'}{' '}
                <span className="text-app-muted">→</span>{' '}
                {request.toPosition.name ?? 'Unknown position'}
              </p>
              {(() => {
                const employee = people.find((person) => person.id === request.subject.id);
                return employee ? (
                  <div className="mt-3 grid gap-2 text-xs text-app-muted sm:grid-cols-3">
                    <span>Department: {employee.department?.name ?? 'Not assigned'}</span>
                    <span>Team: {employee.team?.name ?? 'Not assigned'}</span>
                    <span>Reports to: {employee.reportsTo?.name ?? 'Not assigned'}</span>
                    <span>
                      Requested team: {request.requestedTeam?.name ?? 'Preserve current team'}
                    </span>
                    <span>
                      Requested reports to: {request.requestedReportsTo?.name ?? 'Unchanged'}
                    </span>
                  </div>
                ) : null;
              })()}
              <p className="mt-1 text-xs text-app-muted">
                Requested team: {request.requestedTeam?.name ?? 'Preserve current team'} ·{' '}
                Requested reports to: {request.requestedReportsTo?.name ?? 'Preserve current manager'}
              </p>
              <p className="mt-1 text-xs text-app-muted">
                Requested by {request.requestedBy.fullName} · Reason: {request.reason}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <Field
                  label="Decision reason"
                  value={decisionReasons[request.id] ?? ''}
                  onChange={(value) => onDecisionReasonChange(request.id, value)}
                  placeholder="Required for approval or rejection"
                  required
                  disabled={decisionBusyId === request.id}
                />
                <Button
                  disabled={
                    decisionBusyId === request.id ||
                    !(decisionReasons[request.id] ?? '').trim()
                  }
                  onClick={() => onDecision(request, true)}
                >
                  {decisionBusyId === request.id ? 'Saving…' : 'Approve'}
                </Button>
                <Button
                  kind="danger"
                  disabled={
                    decisionBusyId === request.id ||
                    !(decisionReasons[request.id] ?? '').trim()
                  }
                  onClick={() => onDecision(request, false)}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function PersonResult({
  result,
  reachableScreens,
  screensByAction,
}: {
  result: EffectiveAccessResponse;
  reachableScreens: Array<{ label: string; path: string; requiredAction: Action }>;
  screensByAction: ReadonlyMap<Action, readonly { label: string; path: string }[]>;
}): React.JSX.Element {
  const grouped = new Map<string, AccessPolicyRow[]>();
  result.policies.forEach((policy) => {
    const rows = grouped.get(policy.module) ?? [];
    rows.push(policy);
    grouped.set(policy.module, rows);
  });
  return (
    <div className="mt-6 space-y-6">
      <Card>
        <h2 className="font-display text-xl font-bold">{result.subject.fullName}</h2>
        <p className="mt-1 text-sm text-app-muted">
          {result.subject.email ?? result.subject.accountType}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Summary label="Position" value={result.subject.position?.name ?? 'None'} />
          <Summary label="Department" value={result.subject.department?.name ?? 'None'} />
          <Summary label="Subordinates" value={String(result.subordinateIds.length)} />
        </div>
      </Card>
      <Card>
        <h2 className="font-display text-xl font-bold">Effective policies</h2>
        <div className="mt-4 space-y-5">
          {[...grouped.entries()].map(([moduleName, policies]) => (
            <section key={moduleName}>
              <h3 className="font-semibold">{moduleTitle(moduleName as ModuleName)}</h3>
              <div className="mt-2 space-y-2">
                {policies.map((policy) => (
                  <div
                    key={policy.action}
                    className="rounded-lg border border-app-border p-3 text-sm"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold">{policy.action}</span>
                      <span
                        className={policy.allowed ? 'text-app-accent' : 'text-app-muted'}
                      >
                        {policy.allowed ? `Allow · ${policy.scope ?? 'Global'}` : 'Deny'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-app-muted">
                      Source: {policy.source}
                      {policy.override ? ` · ${policy.override.reason}` : ''}
                    </p>
                    {screensByAction.get(policy.action)?.length ? (
                      <p className="mt-1 text-xs text-app-muted">
                        Screens:{' '}
                        {screensByAction
                          .get(policy.action)!
                          .map((screen) => screen.label)
                          .join(', ')}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-xl font-bold">Subordinates</h2>
          <div className="mt-3 space-y-2 text-sm">
            {result.subordinates.length === 0 ? (
              <p className="text-app-muted">None resolved.</p>
            ) : (
              result.subordinates.map((person) => (
                <p key={person.id}>{person.fullName}</p>
              ))
            )}
          </div>
        </Card>
        <Card>
          <h2 className="font-display text-xl font-bold">Reachable screens</h2>
          <div className="mt-3 space-y-2 text-sm">
            {reachableScreens.length === 0 ? (
              <p className="text-app-muted">
                No protected workspace screens are mapped to this person&apos;s allowed
                actions.
              </p>
            ) : (
              reachableScreens.map((screen) => (
                <p key={screen.path}>
                  {screen.label} <span className="text-app-muted">({screen.path})</span>
                </p>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function CapabilityResult({
  action,
  holders,
}: {
  action: Action;
  holders: CapabilityHolder[];
}): React.JSX.Element {
  return (
    <Card className="mt-6">
      <h2 className="font-display text-xl font-bold">Who can use {action}?</h2>
      <div className="mt-4 space-y-3">
        {holders.length === 0 ? (
          <p className="text-sm text-app-muted">No active holders.</p>
        ) : (
          holders.map((holder) => (
            <div
              key={holder.user.id}
              className="rounded-lg border border-app-border p-3 text-sm"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{holder.user.fullName}</span>
                <span className="text-app-accent">{holder.scope ?? 'Global'}</span>
              </div>
              <p className="mt-1 text-xs text-app-muted">
                {holder.user.email ?? holder.user.accountType} · {holder.source} ·{' '}
                {holder.reason}
              </p>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function OverrideOverviewResult({
  overrides,
  onRevoke,
  revokingId,
  message,
  messageError,
}: {
  overrides: OverrideOverviewItem[];
  onRevoke: (overrideId: string) => void;
  revokingId: string | null;
  message: string;
  messageError: boolean;
}): React.JSX.Element {
  return (
    <Card className="mt-6">
      <h2 className="font-display text-xl font-bold">Active overrides</h2>
      {message ? <Notice error={messageError}>{message}</Notice> : null}
      <div className="mt-4 space-y-3">
        {overrides.length === 0 ? (
          <p className="text-sm text-app-muted">No active overrides.</p>
        ) : (
          overrides.map((override) => (
            <div
              key={override.id}
              className="rounded-lg border border-app-border p-3 text-sm"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">
                  {override.user.fullName} · {override.action}
                </span>
                <span
                  className={
                    override.reviewRequired ? 'text-amber-600' : 'text-app-accent'
                  }
                >
                  {override.reviewRequired
                    ? 'Review required (>180 days)'
                    : `${override.ageDays} days old`}
                </span>
              </div>
              <p className="mt-1 text-xs text-app-muted">
                {override.position?.name ?? 'No position'} · {override.scope} ·{' '}
                Effect: {override.allowed ? 'Allow' : 'Deny'} · Source: User override
              </p>
              <p className="mt-1 text-xs text-app-muted">Reason: {override.reason}</p>
              {override.fields ? (
                <p className="mt-1 text-xs text-app-muted">
                  Fields: {override.fields.join(', ') || 'none'}
                </p>
              ) : null}
              {override.recommendPositionPolicy ? (
                <p className="mt-2 text-xs text-amber-600">
                  Advisory: {override.matchingOverrideCount}/
                  {override.positionHolderCount} holders share this override; consider a
                  Position Policy default.
                </p>
              ) : null}
              <Button
                kind="danger"
                className="mt-3"
                onClick={() => onRevoke(override.id)}
                disabled={revokingId === override.id}
              >
                {revokingId === override.id ? 'Revoking…' : 'Revoke override'}
              </Button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function DelegationPanel({
  people,
  selectedUserId,
  onTargetChange,
  options,
  selectedAction,
  onActionChange,
  allowed,
  onAllowedChange,
  selectedScope,
  onScopeChange,
  reason,
  onReasonChange,
  expiry,
  onExpiryChange,
  narrowFields,
  onNarrowFieldsChange,
  fields,
  onFieldsChange,
  busy,
  message,
  messageError,
  onSubmit,
}: {
  people: AccessPerson[];
  selectedUserId: string;
  onTargetChange: (value: string) => void;
  options: DelegationOption[];
  selectedAction: Action;
  onActionChange: (value: Action) => void;
  allowed: boolean;
  onAllowedChange: (value: boolean) => void;
  selectedScope: Scope;
  onScopeChange: (value: Scope) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  expiry: string;
  onExpiryChange: (value: string) => void;
  narrowFields: boolean;
  onNarrowFieldsChange: (value: boolean) => void;
  fields: string[];
  onFieldsChange: (value: string[]) => void;
  busy: boolean;
  message: string;
  messageError: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}): React.JSX.Element {
  const selected = options.find((option) => option.action === selectedAction);
  return (
    <Card className="mt-6">
      <h2 className="font-display text-xl font-bold">Delegation</h2>
      <p className="mt-1 text-sm text-app-muted">
        Grant controls are enabled only when the backend confirms root-of-trust, ceiling,
        boundary, and seniority constraints.
      </p>
      <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
        <Select
          label="Target person"
          value={selectedUserId}
          onChange={onTargetChange}
          options={people.map((person) => ({ value: person.id, label: person.fullName }))}
        />
        <label className="text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Capability</span>
          <select
            value={selectedAction}
            onChange={(event) => onActionChange(event.target.value as Action)}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          >
            {options.map((option) => (
              <option
                key={option.action}
                value={option.action}
                disabled={!option.canGrant}
                title={option.reason ?? undefined}
              >
                {option.action}
                {option.canGrant ? '' : ` — ${option.reason ?? 'Not grantable'}`}
              </option>
            ))}
          </select>
          {options.some((option) => !option.canGrant) ? (
            <div
              className="mt-3 rounded-lg border border-app-border bg-app-background/50 p-3"
              aria-label="Delegation constraints"
            >
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">
                Unavailable capabilities
              </p>
              <div className="mt-2 space-y-2">
                {options
                  .filter((option) => !option.canGrant)
                  .map((option) => (
                    <div key={option.action} className="text-xs">
                      <span className="font-semibold">{option.action}</span>
                      <span className="ml-2 text-app-muted">
                        {option.reason ?? 'The backend found no grantable scope.'}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
        </label>
        <Select
          label="Effect"
          value={allowed ? 'allow' : 'deny'}
          onChange={(value) => {
            const nextAllowed = value === 'allow';
            onAllowedChange(nextAllowed);
            if (!nextAllowed) onNarrowFieldsChange(false);
          }}
          options={[
            { value: 'allow', label: 'Allow' },
            { value: 'deny', label: 'Deny' },
          ]}
          disabled={busy}
        />
        <Select
          label="Scope"
          value={selectedScope}
          onChange={(value) => onScopeChange(value as Scope)}
          options={(selected?.scopes ?? []).map((scope) => ({
            value: scope,
            label: scope,
          }))}
          disabled={!selected?.canGrant || busy}
        />
        <Field
          label="Reason"
          value={reason}
          onChange={onReasonChange}
          required
          disabled={busy}
        />
        <Field
          label="Expiry (optional)"
          type="datetime-local"
          value={expiry}
          onChange={onExpiryChange}
          disabled={busy}
        />
        <div className="rounded-lg border border-app-border p-3 text-sm md:col-span-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-app-muted">
            <input
              type="checkbox"
              checked={narrowFields}
              onChange={(event) => onNarrowFieldsChange(event.target.checked)}
              disabled={busy || !allowed || selected?.fields === null}
            />
            Narrow to selected fields
          </label>
          {!allowed ? (
            <p className="mt-2 text-xs text-app-muted">
              Field narrowing applies only to Allow overrides. Deny overrides block the
              selected capability.
            </p>
          ) : selected === undefined || selected.fields === null ? (
            <p className="mt-2 text-xs text-app-muted">
              No field metadata is declared for this action, so no field selector is
              available.
            </p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {selected.fields.map((field) => (
                <label
                  key={field}
                  className="flex items-center gap-2 text-xs text-app-muted"
                >
                  <input
                    type="checkbox"
                    checked={fields.includes(field)}
                    onChange={(event) =>
                      onFieldsChange(
                        event.target.checked
                          ? [...fields, field]
                          : fields.filter((current) => current !== field),
                      )
                    }
                    disabled={!allowed || !narrowFields || busy}
                  />
                  {field}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-end gap-3">
          <Button type="submit" disabled={busy || !selected?.canGrant || !reason.trim()}>
            {busy ? 'Saving…' : `${allowed ? 'Allow' : 'Deny'} override`}
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
      {selected && !selected.canGrant ? (
        <Notice error>
          {selected.reason ?? 'This capability cannot be granted to the selected target.'}
        </Notice>
      ) : null}
    </Card>
  );
}

function Summary({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-app-border p-3">
      <p className="text-xs text-app-muted">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
