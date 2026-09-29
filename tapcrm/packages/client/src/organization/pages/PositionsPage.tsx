import { useEffect, useMemo, useState } from 'react';
import {
  ACTIONS,
  REGISTRY,
  actionDescription,
  actionScopes,
  actionScreens,
  isPositionPolicyGrantable,
  moduleTitle,
  protectedCapabilityReason,
  type Action,
  type ModuleName,
} from '@tapcrm/contracts';
import { organizationApi } from '../api/organizationApi.js';
import {
  Button,
  Card,
  Empty,
  ErrorMessage,
  Field,
  Loading,
  Modal,
  Notice,
  Page,
  PositionTree,
  Select,
} from '../components/OrganizationUi.js';
import type {
  OrganizationDepartment,
  OrganizationLadder,
  OrganizationPosition,
  PolicyImpactPreview,
  PositionImpactPreview,
  PositionPolicy,
} from '../types/index.js';

type PositionForm = {
  departmentId: string;
  code: string;
  name: string;
  organizationalLevel: string;
  parentPositionId: string;
  status: string;
};
const blank: PositionForm = {
  departmentId: '',
  code: '',
  name: '',
  organizationalLevel: '1',
  parentPositionId: '',
  status: 'active',
};
function flatten(nodes: OrganizationPosition[]): OrganizationPosition[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

export function PositionsPage(): React.JSX.Element {
  const [departments, setDepartments] = useState<OrganizationDepartment[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [ladder, setLadder] = useState<OrganizationLadder | null>(null);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<OrganizationPosition | null>(null);
  const [impact, setImpact] = useState<PositionImpactPreview | null>(null);
  const [pendingCreate, setPendingCreate] = useState<Record<string, unknown> | null>(
    null,
  );
  const [policies, setPolicies] = useState<PositionPolicy[]>([]);
  const [policyImpact, setPolicyImpact] = useState<PolicyImpactPreview | null>(null);
  const [selectedPolicyPosition, setSelectedPolicyPosition] =
    useState<OrganizationPosition | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
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
    const department = departments.find((item) => item.id === id);
    if (!department) {
      setLadder(null);
      return;
    }
    setLoading(true);
    try {
      setLadder(await organizationApi.ladder(department.code));
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadDepartments();
  }, []);
  useEffect(() => {
    if (departmentId) {
      setForm((current) => ({ ...current, departmentId }));
      void loadLadder(departmentId);
    }
  }, [departmentId, departments.length]);
  const flatPositions = useMemo(() => flatten(ladder?.positions ?? []), [ladder]);
  function startCreate() {
    setEditing(null);
    setImpact(null);
    setPendingCreate(null);
    setForm({ ...blank, departmentId });
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
    });
    setOpen(true);
  }
  function payload(confirmImpact = false): Record<string, unknown> {
    return {
      departmentId: form.departmentId,
      code: form.code,
      name: form.name,
      organizationalLevel: Number(form.organizationalLevel),
      parentPositionId: form.parentPositionId || null,
      status: form.status,
      confirmImpact,
    };
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = payload(Boolean(editing));
      if (editing) {
        await organizationApi.updatePosition(editing.id, { ...body, code: undefined });
        setOpen(false);
        setMessage('Position saved.');
        await loadLadder();
      } else {
        const preview = await organizationApi.previewPosition(body);
        if (preview.positionParentChanges && preview.positionParentChanges.length > 0) {
          setPendingCreate(body);
          setImpact(preview);
        } else {
          await organizationApi.createPosition(body);
          setOpen(false);
          setMessage('Position created.');
          await loadLadder();
        }
      }
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
      setImpact(null);
      setPendingCreate(null);
      setOpen(false);
      setMessage('Position created and hierarchy updated.');
      await loadLadder();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  async function openPolicies(position: OrganizationPosition) {
    setSelectedPolicyPosition(position);
    setPolicyImpact(null);
    setError(null);
    try {
      const persisted = await organizationApi.positionPolicies(position.id);
      const byAction = new Map(persisted.map((policy) => [policy.action, policy]));
      setPolicies(
        ACTIONS.map((action) => {
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
        }),
      );
    } catch (cause) {
      setError(cause);
    }
  }
  function updatePolicy(index: number, patch: Partial<PositionPolicy>) {
    setPolicies((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }
  async function previewPolicies() {
    if (!selectedPolicyPosition) return;
    setBusy(true);
    try {
      setPolicyImpact(
        await organizationApi.previewPositionPolicies(
          selectedPolicyPosition.id,
          positionPolicyPayload(policies),
        ),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  async function savePolicies() {
    if (!selectedPolicyPosition) return;
    setBusy(true);
    try {
      await organizationApi.updatePositionPolicies(
        selectedPolicyPosition.id,
        positionPolicyPayload(policies),
      );
      setMessage('Position policies saved.');
      setPolicyImpact(null);
      setSelectedPolicyPosition(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  const departmentName =
    departments.find((item) => item.id === departmentId)?.name ?? 'Department';
  return (
    <Page
      eyebrow="Organization"
      title="Positions"
      description="Configure positions and inspect the authoritative hierarchy and policy previews."
      action={
        <Button onClick={startCreate} disabled={!departmentId}>
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
      <div className="mt-6 flex flex-wrap items-end gap-4">
        <div className="min-w-64">
          <Select
            label="Department"
            value={departmentId}
            onChange={setDepartmentId}
            options={departments.map((item) => ({ value: item.id, label: item.name }))}
          />
        </div>
        <p className="text-sm text-app-muted">
          {departmentName} hierarchy comes directly from the backend ladder.
        </p>
      </div>
      {loading ? (
        <Loading />
      ) : !ladder || ladder.positions.length === 0 ? (
        <Empty>No positions are visible for this department.</Empty>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <Card>
            <h2 className="font-display text-xl font-bold">Position hierarchy</h2>
            <p className="mt-1 text-sm text-app-muted">
              Select a position to edit it or view its policies.
            </p>
            <div className="mt-5">
              <PositionTree
                nodes={ladder.positions}
                onSelect={(id) => {
                  const position = flatPositions.find((item) => item.id === id);
                  if (position) startEdit(position);
                }}
              />
            </div>
          </Card>
          <Card>
            <h2 className="font-display text-xl font-bold">Position records</h2>
            <div className="mt-4 space-y-2">
              {flatPositions.map((position) => (
                <div
                  key={position.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-app-border p-3"
                >
                  <div>
                    <p className="text-sm font-semibold">{position.name}</p>
                    <p className="text-xs text-app-muted">
                      {position.holderCount ?? 0} holders · {position.status}
                    </p>
                  </div>
                  <Button
                    kind="secondary"
                    onClick={() => {
                      void openPolicies(position);
                    }}
                  >
                    Policies
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      {open && (
        <Modal
          title={editing ? 'Edit position' : 'Create position'}
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={(event) => {
              void save(event);
            }}
            className="grid gap-4 md:grid-cols-2"
          >
            <Field
              label="Code"
              value={form.code}
              onChange={(value) => setForm({ ...form, code: value })}
              required
            />
            <Field
              label="Name"
              value={form.name}
              onChange={(value) => setForm({ ...form, name: value })}
              required
            />
            <Field
              label="Organizational level"
              type="number"
              value={form.organizationalLevel}
              onChange={(value) => setForm({ ...form, organizationalLevel: value })}
              required
            />
            <Select
              label="Parent position"
              value={form.parentPositionId}
              onChange={(value) => setForm({ ...form, parentPositionId: value })}
              options={flatPositions
                .filter((item) => item.id !== editing?.id)
                .map((item) => ({
                  value: item.id,
                  label: `${item.name} · L${item.organizationalLevel}`,
                }))}
              required={!editing || editing.parentPositionId !== null}
              disabled={!editing && flatPositions.length === 0}
            />
            {!editing && flatPositions.length === 0 && (
              <p className="text-xs text-app-muted md:col-span-2">
                No parent positions are available. A department root position is
                provisioned by the organization template; custom positions must be created
                beneath an existing position.
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
            onConfirm={() => {
              void confirmCreate();
            }}
            busy={busy}
            onCancel={() => {
              setImpact(null);
              setPendingCreate(null);
            }}
          />
        </Modal>
      )}
      {selectedPolicyPosition && (
        <Modal
          title={`Policies · ${selectedPolicyPosition.name}`}
          onClose={() => setSelectedPolicyPosition(null)}
        >
          <PolicyEditor
            policies={policies}
            onChange={updatePolicy}
            onPreview={() => {
              void previewPolicies();
            }}
            onSave={() => {
              void savePolicies();
            }}
            impact={policyImpact}
            busy={busy}
          />
        </Modal>
      )}
    </Page>
  );
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
  onConfirm,
  busy,
  onCancel,
}: {
  impact: PositionImpactPreview;
  onConfirm: () => void;
  busy: boolean;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <div>
      <p className="text-sm text-app-muted">
        The backend identified affected hierarchy and people before mutation.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-app-border p-3">
          <p className="text-xs text-app-muted">Affected positions</p>
          <p className="mt-1 text-xl font-bold">{impact.affectedPositionIds.length}</p>
        </div>
        <div className="rounded-lg border border-app-border p-3">
          <p className="text-xs text-app-muted">Affected holders</p>
          <p className="mt-1 text-xl font-bold">{impact.affectedHolderIds.length}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {(impact.positionParentChanges ?? []).map((change) => (
          <p
            key={change.positionId}
            className="rounded-lg border border-app-border p-3 text-sm"
          >
            Position <strong>{change.positionId}</strong> will be re-parented.
          </p>
        ))}
        {(impact.reportingRelationships ?? []).map((line, index) => (
          <p key={index} className="rounded-lg border border-app-border p-3 text-sm">
            Reporting line: {displayValue(line['currentReportsTo'])} →{' '}
            {displayValue(line['proposedReportsTo'])}
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
    </div>
  );
}
function displayValue(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value === null || value === undefined) return 'none';
  return JSON.stringify(value);
}
function PolicyEditor({
  policies,
  onChange,
  onPreview,
  onSave,
  impact,
  busy,
}: {
  policies: PositionPolicy[];
  onChange: (index: number, patch: Partial<PositionPolicy>) => void;
  onPreview: () => void;
  onSave: () => void;
  impact: PolicyImpactPreview | null;
  busy: boolean;
}): React.JSX.Element {
  const grouped = new Map<string, Array<{ policy: PositionPolicy; index: number }>>();
  policies.forEach((policy, index) => {
    const definition = REGISTRY[policy.action as Action];
    if (!definition) return;
    const group = grouped.get(definition.module) ?? [];
    group.push({ policy, index });
    grouped.set(definition.module, group);
  });
  return (
    <div>
      <div className="space-y-6">
        {[...grouped.entries()].map(([moduleName, entries]) => (
          <section key={moduleName}>
            <h3 className="font-display text-lg font-bold">
              {moduleTitle(moduleName as ModuleName)}
            </h3>
            <div className="mt-3 space-y-3">
              {entries.map(({ policy, index }) => {
                const definition = REGISTRY[policy.action as Action];
                const locked = protectedCapabilityReason(definition);
                const scopes = actionScopes(definition);
                return (
                  <div
                    key={`${policy.action}-${index}`}
                    className="rounded-lg border border-app-border p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{policy.action}</p>
                        <p className="mt-1 text-sm text-app-muted">
                          {actionDescription(definition)}
                        </p>
                        <p className="mt-1 text-xs text-app-muted">
                          Screens: {actionScreens(definition).join(', ')}
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={policy.allowed}
                          disabled={locked !== null}
                          onChange={(event) =>
                            onChange(index, { allowed: event.target.checked })
                          }
                        />{' '}
                        {locked ? 'Locked' : 'Allowed'}
                      </label>
                    </div>
                    {locked && (
                      <p className="mt-2 rounded-md bg-app-background p-2 text-xs text-app-danger">
                        🔒 {locked}
                      </p>
                    )}
                    <div className="mt-3">
                      <Select
                        label="Scope"
                        value={policy.scope}
                        disabled={locked !== null}
                        onChange={(value) => onChange(index, { scope: value })}
                        options={scopes.map((value) => ({ value, label: value }))}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {impact && (
        <div className="mt-4 rounded-lg border border-app-accent/30 bg-app-accent/10 p-3 text-sm">
          <p className="font-semibold">Policy impact preview</p>
          <p className="mt-1">Added: {impact.capabilitiesAdded.join(', ') || 'none'}</p>
          <p>Removed: {impact.capabilitiesRemoved.join(', ') || 'none'}</p>
          <p>Scope changes: {impact.scopeChanges.length}</p>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" onClick={onPreview} disabled={busy}>
          Preview changes
        </Button>
        <Button onClick={onSave} disabled={busy}>
          Save policies
        </Button>
      </div>
    </div>
  );
}
