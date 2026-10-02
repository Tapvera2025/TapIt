import { useEffect, useMemo, useRef, useState } from 'react';
import { suggestNextCode } from '../../ui/code-suggest.js';
import {
  ACTIONS,
  REGISTRY,
  actionScopes,
  isPositionPolicyGrantable,
  type Action,
} from '@tapcrm/contracts';
import { getCompanyIdentity } from '../../company/api/companyApi.js';
import { organizationApi } from '../api/organizationApi.js';
import {
  PositionHierarchy,
  type PositionPlacement,
} from '../components/PositionHierarchy.js';
import {
  availableParents,
  flattenPositions,
} from '../components/position-hierarchy-model.js';
import {
  PositionPolicyEditor,
  PositionPolicyFooter,
  countPolicyChanges,
} from '../components/PositionPolicyEditor.js';
import {
  Button,
  Empty,
  ErrorMessage,
  Field,
  Loading,
  Modal,
  Notice,
  Page,
  Select,
} from '../components/OrganizationUi.js';
import type {
  OrganizationDepartment,
  OrganizationChart,
  OrganizationLadder,
  OrganizationPosition,
  PolicyImpactPreview,
  PositionImpactPreview,
  PositionPolicy,
} from '../types/index.js';
import { IdentityApiError } from '../../identity/api/authApi.js';

type PositionForm = {
  departmentId: string;
  code: string;
  name: string;
  organizationalLevel: string;
  parentPositionId: string;
  status: string;
  adoptLowerPositions: boolean;
  insertAboveId: string | null;
};
type PositionField = 'code' | 'name' | 'organizationalLevel' | 'parentPositionId';
type PositionFieldErrors = Partial<Record<PositionField, string>>;
const blank: PositionForm = {
  departmentId: '',
  code: '',
  name: '',
  organizationalLevel: '1',
  parentPositionId: '',
  status: 'active',
  adoptLowerPositions: false,
  insertAboveId: null,
};

type PendingPositionUpdate = {
  position: OrganizationPosition;
  body: Record<string, unknown>;
  impact: PositionImpactPreview;
  parentPositionId: string | null;
  organizationalLevel: number;
};

export function PositionsPage(): React.JSX.Element {
  const [departments, setDepartments] = useState<OrganizationDepartment[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [ladder, setLadder] = useState<OrganizationLadder | null>(null);
  const [chart, setChart] = useState<OrganizationChart | null>(null);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<OrganizationPosition | null>(null);
  const [impact, setImpact] = useState<PositionImpactPreview | null>(null);
  const [pendingCreate, setPendingCreate] = useState<Record<string, unknown> | null>(
    null,
  );
  const [pendingUpdate, setPendingUpdate] = useState<PendingPositionUpdate | null>(null);
  const [policies, setPolicies] = useState<PositionPolicy[]>([]);
  /** The policies as saved, to count and mark what has changed. */
  const [policyBaseline, setPolicyBaseline] = useState<PositionPolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policyError, setPolicyError] = useState<unknown>(null);
  const [policyImpact, setPolicyImpact] = useState<PolicyImpactPreview | null>(null);
  const [selectedPolicyPosition, setSelectedPolicyPosition] =
    useState<OrganizationPosition | null>(null);
  /** The parts of TapCRM this company uses; null until known (then everything is listed). */
  const [enabledModules, setEnabledModules] = useState<ReadonlySet<string> | null>(null);
  const [lastCodeByDept, setLastCodeByDept] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<PositionFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const ladderRequest = useRef(0);
  const policyRequest = useRef(0);
  async function loadDepartments() {
    try {
      const next = await organizationApi.departments();
      setDepartments(next);
      if (!departmentId && next[0]) setDepartmentId(next[0].id);
    } catch (cause) {
      setError(cause);
    } finally {
      if (departments.length === 0) setLoading(false);
    }
  }
  async function loadLadder(id = departmentId) {
    const request = ++ladderRequest.current;
    const department = departments.find((item) => item.id === id);
    setLadder(null);
    if (!department) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await organizationApi.ladder(department.code);
      if (request === ladderRequest.current) setLadder(next);
    } catch (cause) {
      if (request === ladderRequest.current) setError(cause);
    } finally {
      if (request === ladderRequest.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadDepartments();
    getCompanyIdentity()
      .then((identity) => setEnabledModules(new Set(identity.enabledModules)))
      .catch(() => setEnabledModules(null));
  }, []);
  useEffect(() => {
    if (departmentId) {
      setForm((current) => ({ ...current, departmentId }));
      void loadLadder(departmentId);
    }
  }, [departmentId, departments.length]);
  const flatPositions = useMemo(
    () => flattenPositions(ladder?.positions ?? []),
    [ladder],
  );

  function startCreate(
    reference?: OrganizationPosition,
    placement: PositionPlacement = 'below',
  ) {
    setEditing(null);
    setImpact(null);
    setPendingCreate(null);
    setPendingUpdate(null);
    setFieldErrors({});
    setFormError('');

    const parent =
      placement === 'below'
        ? reference
        : flatPositions.find((position) => position.id === reference?.parentPositionId);

    const level = reference
      ? placement === 'below'
        ? Math.max(1, reference.organizationalLevel - 1)
        : placement === 'beside'
          ? reference.organizationalLevel
          : Math.min(parent!.organizationalLevel - 1, reference.organizationalLevel + 1)
      : flatPositions.length === 0
        ? 100
        : 1;

    const allCodes = flatPositions.map((position) => position.code);
    const seed = lastCodeByDept[departmentId];

    setForm({
      ...blank,
      departmentId,
      parentPositionId: parent?.id ?? '',
      organizationalLevel: String(level),
      insertAboveId: placement === 'above' ? (reference?.id ?? null) : null,
      code: suggestNextCode(allCodes, seed),
    });

    setOpen(true);
  }
  function startEdit(position: OrganizationPosition) {
    setEditing(position);
    setImpact(null);
    setForm({
      departmentId: position.departmentId,
      code: position.code,
      name: position.name,
      organizationalLevel: String(position.organizationalLevel),
      parentPositionId: position.parentPositionId ?? '',
      status: position.status,
      adoptLowerPositions: false,
      insertAboveId: null,
    });
    setFieldErrors({});
    setFormError('');
    setOpen(true);
  }
  function updateFormField(field: PositionField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError('');
  }
  function payload(confirmImpact = false): Record<string, unknown> {
    return {
      departmentId: form.departmentId,
      code: form.code,
      name: form.name,
      organizationalLevel: Number(form.organizationalLevel),
      parentPositionId: form.parentPositionId || null,
      status: form.status,
      ...(editing ? {} : { adoptLowerPositions: form.adoptLowerPositions }),
      ...(!editing && form.insertAboveId
        ? { adoptPositionIds: [form.insertAboveId] }
        : {}),
      confirmImpact,
    };
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: PositionFieldErrors = {};
    if (!form.code.trim()) nextErrors.code = 'Position code is required.';
    else if (!editing && !/^[a-z0-9][a-z0-9-]*$/.test(form.code.trim()))
      nextErrors.code = 'Code can use only lowercase letters, numbers, and hyphens.';
    if (!form.name.trim()) nextErrors.name = 'Position name is required.';
    if (
      !form.organizationalLevel ||
      Number(form.organizationalLevel) < 1 ||
      !Number.isInteger(Number(form.organizationalLevel))
    )
      nextErrors.organizationalLevel =
        'Organizational level must be a whole number of at least 1.';
    if (!editing && !form.parentPositionId)
      nextErrors.parentPositionId = 'Parent position is required.';
    setFieldErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const body = payload();
      if (editing) {
        const updateBody = { ...body, code: undefined };
        if (
          editing.parentPositionId !== (form.parentPositionId || null) ||
          editing.organizationalLevel !== Number(form.organizationalLevel) ||
          editing.departmentId !== form.departmentId
        ) {
          const preview = await organizationApi.previewPositionUpdate(
            editing.id,
            updateBody,
          );
          setPendingUpdate({
            position: editing,
            body: updateBody,
            impact: preview,
            parentPositionId: form.parentPositionId || null,
            organizationalLevel: Number(form.organizationalLevel),
          });
          setOpen(false);
        } else {
          await organizationApi.updatePosition(editing.id, updateBody);
          setOpen(false);
          setMessage('Position saved.');
          await loadLadder();
        }
      } else {
        const preview = await organizationApi.previewPosition(body);
        if (preview.positionParentChanges && preview.positionParentChanges.length > 0) {
          setPendingCreate(body);
          setImpact(preview);
          setChart(await organizationApi.chart().catch(() => null));
        } else {
          await organizationApi.createPosition(body);
          setLastCodeByDept((prev) => ({ ...prev, [form.departmentId]: form.code }));
          setOpen(false);
          setMessage('Position created.');
          await loadLadder();
        }
      }
    } catch (cause) {
      if (
        cause instanceof IdentityApiError &&
        cause.code === 'ORG_POSITION_CODE_EXISTS'
      ) {
        setFieldErrors({ code: 'A position with this code already exists.' });
      } else if (cause instanceof Error) {
        setFormError(cause.message);
      } else {
        setFormError('Unable to save position.');
      }
    } finally {
      setBusy(false);
    }
  }
  async function previewMove(
    position: OrganizationPosition,
    parent: OrganizationPosition,
  ) {
    setError(null);
    setBusy(true);
    try {
      const body = { parentPositionId: parent.id };
      const preview = await organizationApi.previewPositionUpdate(position.id, body);
      setPendingUpdate({
        position,
        body,
        impact: preview,
        parentPositionId: parent.id,
        organizationalLevel: position.organizationalLevel,
      });
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  async function confirmUpdate() {
    if (!pendingUpdate) return;
    setError(null);
    setBusy(true);
    try {
      await organizationApi.updatePosition(pendingUpdate.position.id, {
        ...pendingUpdate.body,
        confirmImpact: true,
      });
      setMessage(`${pendingUpdate.position.name} hierarchy updated.`);
      setPendingUpdate(null);
      await loadLadder();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  async function confirmCreate() {
    if (!pendingCreate) return;
    setBusy(true);
    try {
      await organizationApi.createPosition({ ...pendingCreate, confirmImpact: true });
      if (
        typeof pendingCreate['code'] === 'string' &&
        typeof pendingCreate['departmentId'] === 'string'
      ) {
        setLastCodeByDept((prev) => ({
          ...prev,
          [pendingCreate['departmentId'] as string]: pendingCreate['code'] as string,
        }));
      }
      setImpact(null);
      setPendingCreate(null);
      setOpen(false);
      setMessage('Position created and hierarchy updated.');
      await loadLadder();
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : 'Unable to apply hierarchy change.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function openPolicies(position: OrganizationPosition) {
    const request = ++policyRequest.current;
    setSelectedPolicyPosition(position);
    setPolicies([]);
    setPolicyBaseline([]);
    setPolicyImpact(null);
    setPolicyError(null);
    setPoliciesLoading(true);
    try {
      const persisted = await organizationApi.positionPolicies(position.id);
      if (request !== policyRequest.current) return;
      const byAction = new Map(persisted.map((policy) => [policy.action, policy]));
      const loaded = ACTIONS.map((action) => {
        const definition = REGISTRY[action];
        return (
          byAction.get(action) ?? {
            action,
            allowed: false,
            scope: actionScopes(definition)[0] ?? 'own',
            fields: null,
            constraints: null,
          }
        );
      });
      setPolicies(loaded);
      setPolicyBaseline(loaded);
    } catch (cause) {
      if (request === policyRequest.current) setPolicyError(cause);
    } finally {
      if (request === policyRequest.current) setPoliciesLoading(false);
    }
  }
  function closePolicies() {
    policyRequest.current += 1;
    setSelectedPolicyPosition(null);
    setPolicyImpact(null);
    setPolicyError(null);
  }
  function updatePolicy(index: number, patch: Partial<PositionPolicy>) {
    // A preview describes the policies it was made from; an edit makes it stale.
    setPolicyImpact(null);
    setPolicies((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }
  async function previewPolicies() {
    if (!selectedPolicyPosition) return;
    setBusy(true);
    setPolicyError(null);
    try {
      setPolicyImpact(
        await organizationApi.previewPositionPolicies(
          selectedPolicyPosition.id,
          positionPolicyPayload(policies),
        ),
      );
    } catch (cause) {
      setPolicyError(cause);
    } finally {
      setBusy(false);
    }
  }
  async function savePolicies() {
    if (!selectedPolicyPosition) return;
    setBusy(true);
    setPolicyError(null);
    try {
      await organizationApi.updatePositionPolicies(
        selectedPolicyPosition.id,
        positionPolicyPayload(policies),
      );
      setMessage(`Policies saved for ${selectedPolicyPosition.name}.`);
      closePolicies();
    } catch (cause) {
      setPolicyError(cause);
    } finally {
      setBusy(false);
    }
  }
  const policyChanges = countPolicyChanges(policies, policyBaseline);
  const departmentName =
    departments.find((item) => item.id === departmentId)?.name ?? 'Department';
  return (
    <Page
      eyebrow="Organization"
      title="Positions"
      description="Explore each department’s hierarchy, understand every role, and manage its policies."
      action={
        <Button
          onClick={() => startCreate()}
          disabled={!departmentId || loading || !ladder}
        >
          Add position
        </Button>
      }
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
      {loading || !ladder ? (
        <>
          <div className="mt-6 max-w-sm">
            <Select
              label="Department"
              value={departmentId}
              onChange={setDepartmentId}
              options={departments.map((item) => ({ value: item.id, label: item.name }))}
            />
          </div>
          {loading ? (
            <Loading />
          ) : departments.length === 0 ? (
            <Empty>No departments are available yet.</Empty>
          ) : error ? (
            <div className="mt-4">
              <Button
                kind="secondary"
                onClick={() => {
                  void loadLadder();
                }}
              >
                Retry loading positions
              </Button>
            </div>
          ) : (
            <Empty>Select a department to explore its positions.</Empty>
          )}
        </>
      ) : (
        <PositionHierarchy
          key={departmentId}
          departments={departments}
          departmentId={departmentId}
          positions={ladder.positions}
          onDepartmentChange={(id) => {
            setDepartmentId(id);
            setMessage('');
          }}
          onEdit={startEdit}
          onCreate={startCreate}
          onMove={(position, parent) => {
            void previewMove(position, parent);
          }}
          onPolicies={(position) => {
            void openPolicies(position);
          }}
        />
      )}
      {open && (
        <Modal
          title={editing ? 'Edit position' : 'Create position'}
          onClose={() => setOpen(false)}
        >
          <p className="mb-4 text-sm text-app-muted">
            {departmentName} ·{' '}
            {editing
              ? 'Update this position’s details and place in the hierarchy.'
              : 'Choose where the new position belongs.'}
          </p>
          {Boolean(error) && (
            <div className="mb-4">
              <ErrorMessage cause={error} />
            </div>
          )}
          <form
            noValidate
            onSubmit={(event) => {
              void save(event);
            }}
            className="grid gap-4 md:grid-cols-2"
          >
            <div>
              <Field
                label="Code"
                disabled={Boolean(editing)}
                value={form.code}
                onChange={(value) => updateFormField('code', value)}
                error={fieldErrors.code}
                required
              />

              {!editing && (
                <p className="mt-1 text-xs text-app-muted">
                  Auto-generated — edit as needed.
                </p>
              )}
            </div>
            <Field
              label="Name"
              value={form.name}
              onChange={(value) => updateFormField('name', value)}
              error={fieldErrors.name}
              required
            />
            <Field
              label="Organizational level"
              type="number"
              value={form.organizationalLevel}
              onChange={(value) => updateFormField('organizationalLevel', value)}
              error={fieldErrors.organizationalLevel}
              required
            />
            <Select
              label="Parent position"
              value={form.parentPositionId}
              onChange={(value) => {
                updateFormField('parentPositionId', value);
                setForm((current) => ({
                  ...current,
                  parentPositionId: value,
                  insertAboveId: null,
                }));
              }}
              options={availableParents(flatPositions, editing).map((item) => ({
                value: item.id,
                label: `${item.name} · L${item.organizationalLevel}`,
              }))}
              required={
                flatPositions.length > 0 &&
                !form.adoptLowerPositions &&
                (!editing || editing.parentPositionId !== null)
              }
              disabled={!editing && flatPositions.length === 0}
              error={fieldErrors.parentPositionId}
            />
            <p className="text-xs text-app-muted md:col-span-2">
              Levels range from 1 to 100. A parent must have a higher level than the
              positions below it.
              {form.parentPositionId &&
                ` Selected parent: level ${flatPositions.find((item) => item.id === form.parentPositionId)?.organizationalLevel ?? '—'}.`}
            </p>
            {!editing && flatPositions.length === 0 && (
              <p className="text-xs text-app-muted md:col-span-2">
                This is the department&apos;s first position. It becomes the top of the
                department (for example its head) and reports to the Super Admin; later
                positions are created beneath it.
              </p>
            )}
            {!editing && flatPositions.length > 0 && (
              <label className="flex items-start gap-2 text-xs text-app-muted md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.adoptLowerPositions}
                  disabled={Boolean(form.insertAboveId)}
                  onChange={(event) =>
                    setForm({ ...form, adoptLowerPositions: event.target.checked })
                  }
                  className="mt-0.5"
                />
                <span>
                  {form.parentPositionId
                    ? "Also move the parent's lower-level positions under this one (insert a new level). Leave unticked to add it beside them; nothing else moves."
                    : 'Place this as the new top of the hierarchy — all current root positions will become its direct reports.'}
                </span>
              </label>
            )}
            {form.insertAboveId && (
              <p className="text-xs text-app-muted md:col-span-2">
                This new position will become the direct parent of{' '}
                <strong>
                  {
                    flatPositions.find((position) => position.id === form.insertAboveId)
                      ?.name
                  }
                </strong>
                . You can review the change before it is saved.
              </p>
            )}
            <Select
              label="Status"
              value={form.status}
              onChange={(value) => setForm({ ...form, status: value })}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
            <Button type="submit" disabled={busy} className="md:col-span-2">
              {busy ? 'Saving…' : 'Save position'}
            </Button>
            {formError && <ErrorMessage cause={new Error(formError)} />}
          </form>
        </Modal>
      )}
      {impact && (
        <Modal
          title="Confirm hierarchy change"
          onClose={() => {
            setImpact(null);
            setPendingCreate(null);
          }}
        >
          <ImpactPreview
            impact={impact}
            positions={flatPositions}
            chart={chart}
            formError={formError}
            onConfirm={() => {
              void confirmCreate();
            }}
            busy={busy}
            onCancel={() => {
              setImpact(null);
              setPendingCreate(null);
              setFormError('');
            }}
          />
        </Modal>
      )}
      {pendingUpdate && (
        <Modal title="Review hierarchy change" onClose={() => setPendingUpdate(null)}>
          <p className="text-sm text-app-muted">
            {pendingUpdate.position.name} will move from under{' '}
            <strong>
              {nameOfParent(pendingUpdate.position.parentPositionId, flatPositions)}
            </strong>{' '}
            to under{' '}
            <strong>{nameOfParent(pendingUpdate.parentPositionId, flatPositions)}</strong>
            {pendingUpdate.organizationalLevel !==
              pendingUpdate.position.organizationalLevel &&
              `, at level ${pendingUpdate.organizationalLevel}`}
            . This can change access inherited through the hierarchy.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-app-border p-3">
              <p className="text-xs text-app-muted">Positions affected</p>
              <p className="mt-1 text-xl font-bold">
                {pendingUpdate.impact.affectedPositionIds.length}
              </p>
            </div>
            <div className="rounded-lg border border-app-border p-3">
              <p className="text-xs text-app-muted">People affected</p>
              <p className="mt-1 text-xl font-bold">
                {pendingUpdate.impact.affectedHolderIds.length}
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <Button
              kind="secondary"
              disabled={busy}
              onClick={() => setPendingUpdate(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void confirmUpdate();
              }}
            >
              {busy ? 'Applying…' : 'Confirm change'}
            </Button>
          </div>
        </Modal>
      )}
      {selectedPolicyPosition && (
        <Modal
          size="lg"
          title={`Policies for ${selectedPolicyPosition.name}`}
          onClose={closePolicies}
          dirty={policyChanges > 0}
          footer={
            <PositionPolicyFooter
              changes={policyChanges}
              busy={busy || policiesLoading}
              onPreview={() => {
                void previewPolicies();
              }}
              onSave={() => {
                void savePolicies();
              }}
            />
          }
        >
          {Boolean(policyError) && (
            <div className="mb-4">
              <ErrorMessage cause={policyError} />
            </div>
          )}
          {policiesLoading ? (
            <p className="py-10 text-center text-sm text-app-muted">Loading policies…</p>
          ) : (
            policies.length > 0 && (
              <PositionPolicyEditor
                positionName={selectedPolicyPosition.name}
                policies={policies}
                baseline={policyBaseline}
                enabledModules={enabledModules}
                onChange={updatePolicy}
                impact={policyImpact}
              />
            )
          )}
        </Modal>
      )}
    </Page>
  );
}
function nameOfParent(
  id: string | null,
  positions: readonly OrganizationPosition[],
): string {
  return id === null
    ? 'Super Admin'
    : (positions.find((position) => position.id === id)?.name ?? 'another position');
}
function positionPolicyPayload(policies: PositionPolicy[]) {
  return policies.flatMap((policy) => {
    const definition = REGISTRY[policy.action as Action];
    return definition && isPositionPolicyGrantable(definition)
      ? [stripPolicy(policy)]
      : [];
  });
}
function stripPolicy(policy: PositionPolicy) {
  return {
    action: policy.action,
    allowed: policy.allowed,
    scope: policy.scope,
    fields: policy.fields,
    constraints: policy.constraints,
  };
}
function ImpactPreview({
  impact,
  positions,
  chart,
  formError,
  onConfirm,
  busy,
  onCancel,
}: {
  impact: PositionImpactPreview;
  positions: OrganizationPosition[];
  chart: OrganizationChart | null;
  formError: string;
  onConfirm: () => void;
  busy: boolean;
  onCancel: () => void;
}): React.JSX.Element {
  const positionNames = new Map(
    positions.map((position) => [position.id, position.name]),
  );
  const employeeNames = new Map(
    (chart?.people ?? []).map((person) => [person.id, person.fullName]),
  );
  const proposedPositionName = impact.position?.name ?? 'the new position';

  return (
    <div>
      <p className="text-sm text-app-muted">
        Adding this position changes who reports to whom. Check the changes before you
        confirm.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-app-border p-3">
          <p className="text-xs text-app-muted">Positions affected</p>
          <p className="mt-1 text-xl font-bold">{impact.affectedPositionIds.length}</p>
        </div>
        <div className="rounded-lg border border-app-border p-3">
          <p className="text-xs text-app-muted">People affected</p>
          <p className="mt-1 text-xl font-bold">{impact.affectedHolderIds.length}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {(impact.positionParentChanges ?? []).map((change) => (
          <p
            key={change.positionId}
            className="rounded-lg border border-app-border p-3 text-sm"
          >
            Position <strong>{positionName(change.positionId, positionNames)}</strong>{' '}
            will be re-parented from{' '}
            <strong>{positionName(change.currentParentPositionId, positionNames)}</strong>{' '}
            to{' '}
            <strong>
              {change.proposedParentPositionId
                ? positionName(change.proposedParentPositionId, positionNames)
                : proposedPositionName}
            </strong>
            .
          </p>
        ))}
        {(impact.reportingRelationships ?? []).map((line, index) => (
          <p key={index} className="rounded-lg border border-app-border p-3 text-sm">
            Reporting line for{' '}
            <strong>{personName(line['userId'], employeeNames)}</strong>:{' '}
            {personName(line['currentReportsTo'], employeeNames)} →{' '}
            {personName(line['proposedReportsTo'], employeeNames)}
          </p>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          {busy ? 'Applying…' : 'Confirm and apply'}
        </Button>
      </div>
      {formError && (
        <div className="mt-4">
          <ErrorMessage cause={new Error(formError)} />
        </div>
      )}
    </div>
  );
}
function positionName(id: unknown, names: Map<string, string>): string {
  if (typeof id !== 'string' || id.length === 0) return 'none';
  return names.get(id) ?? 'unavailable position';
}
function personName(id: unknown, names: Map<string, string>): string {
  if (typeof id !== 'string' || id.length === 0) return 'none';
  return names.get(id) ?? 'unavailable employee';
}
