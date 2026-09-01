/** A position is either staffable or retired; OR-5 forbids deleting one in use. */
export type PositionStatus = 'active' | 'inactive';

import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import Modal from '../../components/common/Modal';
import {
  PositionLadderIcon,
  PlusIcon,
  EditIcon,
  UsersIcon,
  ShieldIcon,
  RefreshIcon,
  AlertCircleIcon,
  CheckIcon,
} from '../../components/common/Icons';

interface Position {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  organizationalLevel: number;
  parentPositionId: string | null;
  isSeeded: boolean;
  status: PositionStatus;
  maxDealValue: string | null;
  maxDiscountPercent: number | null;
  allowsCustomTerms: boolean;
  holderCount?: number;
}

interface Department {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: string;
}

interface PositionHolder {
  id: string;
  fullName: string;
  email: string | null;
  status: string;
}

interface PositionPolicy {
  action: string;
  allowed: boolean;
  scope: string;
  fields?: string[] | null;
  constraints?: string[] | null;
}

interface PolicyImpact {
  affectedHolders: number;
  actionChanges: Array<{
    action: string;
    before?: string;
    after: string;
  }>;
}

export default function PositionsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptCode, setSelectedDeptCode] = useState<string>('dev');
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [holdersModalOpen, setHoldersModalOpen] = useState(false);
  const [policiesModalOpen, setPoliciesModalOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [positionHolders, setPositionHolders] = useState<PositionHolder[]>([]);
  const [positionPolicies, setPositionPolicies] = useState<PositionPolicy[]>([]);
  const [policyImpact, setPolicyImpact] = useState<PolicyImpact | null>(null);
  const [saving, setSaving] = useState(false);

  // Forms
  const [createForm, setCreateForm] = useState({
    code: '',
    name: '',
    organizationalLevel: 25,
    parentPositionId: '',
    maxDealValue: '',
    maxDiscountPercent: '',
    allowsCustomTerms: false,
  });

  const [editForm, setEditForm] = useState({
    name: '',
    organizationalLevel: 25,
    parentPositionId: '',
    maxDealValue: '',
    maxDiscountPercent: '',
    allowsCustomTerms: false,
    status: 'active' as PositionStatus,
  });

  const loadDepartments = async () => {
    try {
      const deptRes = await api.get<{ success: boolean; data: Department[] }>('/org/departments');
      const depts = deptRes.data.data || [];
      setDepartments(depts);
      if (depts.length > 0 && !selectedDeptCode) {
        setSelectedDeptCode(depts[0]!.code);
      }
    } catch {
      setError('Unable to load departments list.');
    }
  };

  const loadLadder = async (deptCode: string) => {
    if (!deptCode) return;
    try {
      setLoading(true);
      setError('');
      const ladderRes = await api.get<{ success: boolean; data: Position[] }>(`/org/ladder/${deptCode}`);
      setPositions(ladderRes.data.data || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || `Failed to load ladder for department "${deptCode}".`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDepartments();
  }, []);

  useEffect(() => {
    if (selectedDeptCode) {
      void loadLadder(selectedDeptCode);
    }
  }, [selectedDeptCode]);

  const currentDepartment = departments.find((d) => d.code === selectedDeptCode);

  const handleOpenCreate = () => {
    setCreateForm({
      code: '',
      name: '',
      organizationalLevel: 25,
      parentPositionId: positions[0]?.id || '',
      maxDealValue: '',
      maxDiscountPercent: '',
      allowsCustomTerms: false,
    });
    setError('');
    setCreateModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentDepartment) return;

    if (!createForm.code.trim() || !createForm.name.trim()) {
      setError('Position code and name are required.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await api.post('/org/positions', {
        departmentId: currentDepartment.id,
        code: createForm.code.trim().toLowerCase(),
        name: createForm.name.trim(),
        organizationalLevel: Number(createForm.organizationalLevel),
        parentPositionId: createForm.parentPositionId || null,
        maxDealValue: createForm.maxDealValue ? createForm.maxDealValue : null,
        maxDiscountPercent: createForm.maxDiscountPercent ? Number(createForm.maxDiscountPercent) : null,
        allowsCustomTerms: createForm.allowsCustomTerms,
      });
      setCreateModalOpen(false);
      setSuccessMessage(`Position "${createForm.name}" created successfully.`);
      await loadLadder(selectedDeptCode);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to create position.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEdit = (pos: Position) => {
    setSelectedPosition(pos);
    setEditForm({
      name: pos.name,
      organizationalLevel: pos.organizationalLevel,
      parentPositionId: pos.parentPositionId || '',
      maxDealValue: pos.maxDealValue || '',
      maxDiscountPercent: pos.maxDiscountPercent !== null ? String(pos.maxDiscountPercent) : '',
      allowsCustomTerms: pos.allowsCustomTerms,
      status: pos.status,
    });
    setError('');
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPosition) return;

    try {
      setSaving(true);
      setError('');
      await api.patch(`/org/positions/${selectedPosition.id}`, {
        name: selectedPosition.isSeeded ? undefined : editForm.name.trim(),
        organizationalLevel: selectedPosition.isSeeded ? undefined : Number(editForm.organizationalLevel),
        parentPositionId: selectedPosition.isSeeded ? undefined : editForm.parentPositionId || null,
        maxDealValue: editForm.maxDealValue ? editForm.maxDealValue : null,
        maxDiscountPercent: editForm.maxDiscountPercent ? Number(editForm.maxDiscountPercent) : null,
        allowsCustomTerms: editForm.allowsCustomTerms,
        status: editForm.status,
      });
      setEditModalOpen(false);
      setSuccessMessage(`Position updated successfully.`);
      await loadLadder(selectedDeptCode);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to update position.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenHolders = async (pos: Position) => {
    setSelectedPosition(pos);
    try {
      setError('');
      const res = await api.get<{ success: boolean; data: PositionHolder[] }>(`/org/positions/${pos.id}/holders`);
      setPositionHolders(res.data.data || []);
      setHoldersModalOpen(true);
    } catch {
      setError('Unable to load holders for this position.');
    }
  };

  const handleOpenPolicies = async (pos: Position) => {
    setSelectedPosition(pos);
    try {
      setError('');
      setPolicyImpact(null);
      const res = await api.get<{ success: boolean; data: PositionPolicy[] }>(`/org/positions/${pos.id}/policies`);
      setPositionPolicies(res.data.data || []);
      setPoliciesModalOpen(true);
    } catch {
      setError('Unable to load authorization policies.');
    }
  };

  const handlePreviewPolicies = async () => {
    if (!selectedPosition) return;
    try {
      const res = await api.post<{ success: boolean; data: PolicyImpact }>(
        `/org/positions/${selectedPosition.id}/policy-preview`,
        { policies: positionPolicies },
      );
      setPolicyImpact(res.data.data);
    } catch {
      setError('Failed to preview policy impact.');
    }
  };

  return (
    <div className="page-container">
      {/* HEADER */}
      <div className="page-header">
        <div className="page-header-title">
          <h1>Positions Ladder & Authority Levels</h1>
          <p>
            Positions are units of organizational authority that hold capability policies, approval limits, and reporting ladders (PRD §4.3).
          </p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { void loadLadder(selectedDeptCode); }}
            disabled={loading}
          >
            <RefreshIcon size={16} />
            <span>Refresh</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={handleOpenCreate}>
            <PlusIcon size={16} />
            <span>Add Position</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircleIcon className="alert-icon" />
          <div>
            <strong>Error</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="alert alert-success">
          <CheckIcon className="alert-icon" />
          <div>
            <strong>Success</strong>
            <p>{successMessage}</p>
          </div>
        </div>
      )}

      {/* DEPARTMENT SELECTOR TABS */}
      <div className="card" style={{ marginBottom: '20px', padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Select Department Ladder:
          </span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {departments.map((d) => (
              <button
                key={d.code}
                type="button"
                className={`btn btn-sm ${selectedDeptCode === d.code ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSelectedDeptCode(d.code)}
              >
                {d.name} ({d.code.toUpperCase()})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* LADDER TABLE */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading department hierarchy ladder...</span>
        </div>
      ) : positions.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <PositionLadderIcon size={28} />
            </div>
            <h3>No positions found in this ladder</h3>
            <p>Positions define the authority levels and reporting chain for this department.</p>
            <button type="button" className="btn btn-primary" style={{ marginTop: '16px' }} onClick={handleOpenCreate}>
              <PlusIcon size={16} />
              <span>Create Position</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Level</th>
                <th>Code</th>
                <th>Position Title</th>
                <th>Limits & Terms</th>
                <th>Holders</th>
                <th>Origin</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr key={pos.id}>
                  <td>
                    <span className="badge badge-info" style={{ fontWeight: 800 }}>
                      L{pos.organizationalLevel}
                    </span>
                  </td>
                  <td>
                    <code>{pos.code}</code>
                  </td>
                  <td>
                    <strong>{pos.name}</strong>
                  </td>
                  <td>
                    <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {pos.maxDealValue && <span>Deal Cap: ${pos.maxDealValue}</span>}
                      {pos.maxDiscountPercent !== null && <span>Max Disc: {pos.maxDiscountPercent}%</span>}
                      {pos.allowsCustomTerms && <span style={{ color: 'var(--success)' }}>✓ Custom Terms</span>}
                      {!pos.maxDealValue && pos.maxDiscountPercent === null && !pos.allowsCustomTerms && (
                        <span style={{ color: 'var(--text-muted)' }}>Standard</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => { void handleOpenHolders(pos); }}
                      title="View Active Holders"
                    >
                      <UsersIcon size={13} />
                      <span>{pos.holderCount || 0} holders</span>
                    </button>
                  </td>
                  <td>
                    {pos.isSeeded ? (
                      <span className="badge badge-neutral" title="System Seeded Position">Seeded</span>
                    ) : (
                      <span className="badge badge-primary">Custom</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${pos.status === 'active' ? 'badge-active' : 'badge-inactive'}`}>
                      <span className="badge-dot" /> {pos.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => { void handleOpenPolicies(pos); }}
                        title="Inspect RBAC Policies"
                      >
                        <ShieldIcon size={14} />
                        <span>Policies</span>
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => handleOpenEdit(pos)}
                        title="Edit Position"
                      >
                        <EditIcon size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CREATE MODAL */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={`Add Custom Position in ${currentDepartment?.name || 'Department'}`}
        subtitle="Custom positions inherit the authority ladder and must report to a higher level."
      >
        <form onSubmit={(event) => { void handleCreateSubmit(event); }}>
          <div className="form-grid">
            <div className="form-group">
              <label>Position Code</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. lead-analyst"
                value={createForm.code}
                onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
                required
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label>Position Title</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Lead Product Analyst"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                required
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label>
                Organizational Level (1-100)
                <span className="hint">Higher = greater authority</span>
              </label>
              <input
                type="number"
                min="1"
                max="100"
                className="form-control"
                value={createForm.organizationalLevel}
                onChange={(e) => setCreateForm({ ...createForm, organizationalLevel: parseInt(e.target.value, 10) || 25 })}
                required
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label>Parent Reporting Position</label>
              <select
                className="form-control"
                value={createForm.parentPositionId}
                onChange={(e) => setCreateForm({ ...createForm, parentPositionId: e.target.value })}
                disabled={saving}
              >
                <option value="">None (Top of ladder)</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    L{p.organizationalLevel} - {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Max Deal Value ($)</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. 50000.00"
                value={createForm.maxDealValue}
                onChange={(e) => setCreateForm({ ...createForm, maxDealValue: e.target.value })}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label>Max Discount Percent (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                className="form-control"
                placeholder="e.g. 15"
                value={createForm.maxDiscountPercent}
                onChange={(e) => setCreateForm({ ...createForm, maxDiscountPercent: e.target.value })}
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={createForm.allowsCustomTerms}
                  onChange={(e) => setCreateForm({ ...createForm, allowsCustomTerms: e.target.checked })}
                  disabled={saving}
                />
                <span>Authority to approve non-standard contract terms</span>
              </label>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreateModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating Position...' : 'Create Position'}
            </button>
          </div>
        </form>
      </Modal>

      {/* EDIT MODAL */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`Configure Position: ${selectedPosition?.name}`}
        subtitle={selectedPosition?.isSeeded ? 'Seeded position (Identity is locked, approval limits configurable)' : 'Custom position'}
      >
        <form onSubmit={(event) => { void handleEditSubmit(event); }}>
          <div className="form-grid">
            <div className="form-group">
              <label>Position Title</label>
              <input
                type="text"
                className="form-control"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                disabled={saving || selectedPosition?.isSeeded}
              />
            </div>

            <div className="form-group">
              <label>Status</label>
              <select
                className="form-control"
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value as PositionStatus })}
                disabled={saving}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="form-group">
              <label>Max Deal Value ($)</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. 100000.00"
                value={editForm.maxDealValue}
                onChange={(e) => setEditForm({ ...editForm, maxDealValue: e.target.value })}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label>Max Discount Percent (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                className="form-control"
                placeholder="e.g. 20"
                value={editForm.maxDiscountPercent}
                onChange={(e) => setEditForm({ ...editForm, maxDiscountPercent: e.target.value })}
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editForm.allowsCustomTerms}
                  onChange={(e) => setEditForm({ ...editForm, allowsCustomTerms: e.target.checked })}
                  disabled={saving}
                />
                <span>Authority to approve non-standard contract terms</span>
              </label>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </Modal>

      {/* POSITION HOLDERS MODAL */}
      <Modal
        isOpen={holdersModalOpen}
        onClose={() => setHoldersModalOpen(false)}
        title={`Active Position Holders: ${selectedPosition?.name}`}
        subtitle={`Total Staff Assigned: ${positionHolders.length}`}
        maxWidth="md"
      >
        {positionHolders.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <p>No active employees are currently assigned to this position.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {positionHolders.map((holder) => (
              <div
                key={holder.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'var(--bg-surface-hover)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{holder.fullName}</div>
                  {holder.email && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{holder.email}</div>
                  )}
                </div>
                <span className="badge badge-active">Active</span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* POSITION POLICIES MODAL */}
      <Modal
        isOpen={policiesModalOpen}
        onClose={() => setPoliciesModalOpen(false)}
        title={`Authorization Policies: ${selectedPosition?.name}`}
        subtitle="Configured RBAC action permissions and lateral scoping rules"
        maxWidth="lg"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Granted Actions: <strong>{positionPolicies.length}</strong>
          </span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => { void handlePreviewPolicies(); }}>
            Preview Access Impact
          </button>
        </div>

        {policyImpact && (
          <div className="alert alert-info" style={{ marginBottom: '16px' }}>
            <div>
              <strong>Policy Impact Preview</strong>
              <p>
                Modifications affect {policyImpact.affectedHolders} active staff members holding this authority.
              </p>
            </div>
          </div>
        )}

        <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Action Identifier</th>
                <th>Status</th>
                <th>Visibility Scope</th>
              </tr>
            </thead>
            <tbody>
              {positionPolicies.map((pol) => (
                <tr key={pol.action}>
                  <td>
                    <code>{pol.action}</code>
                  </td>
                  <td>
                    <span className="badge badge-success">Allowed</span>
                  </td>
                  <td>
                    <span className="badge badge-info">{pol.scope}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}
