import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import Modal from '../../components/common/Modal';
import {
  DepartmentIcon,
  PlusIcon,
  EditIcon,
  TrashIcon,
  RefreshIcon,
  AlertCircleIcon,
  CheckIcon,
} from '../../components/common/Icons';

interface Department {
  id: string;
  code: string;
  name: string;
  kind: 'support' | 'delivery';
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [saving, setSaving] = useState(false);

  // Form states
  const [createForm, setCreateForm] = useState({
    code: '',
    name: '',
    kind: 'delivery' as 'support' | 'delivery',
  });

  const [editForm, setEditForm] = useState({
    name: '',
    status: 'active' as 'active' | 'inactive',
  });

  const loadDepartments = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get<{ success: boolean; data: Department[] }>('/org/departments');
      setDepartments(res.data.data || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Unable to load departments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDepartments();
  }, []);

  const handleOpenCreate = () => {
    setCreateForm({ code: '', name: '', kind: 'delivery' });
    setError('');
    setCreateModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.code.trim() || !createForm.name.trim()) {
      setError('Department code and name are required.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await api.post('/org/departments', {
        code: createForm.code.trim().toLowerCase(),
        name: createForm.name.trim(),
        kind: createForm.kind,
      });
      setCreateModalOpen(false);
      setSuccessMessage(`Department "${createForm.name}" created successfully.`);
      await loadDepartments();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to create department.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEdit = (dept: Department) => {
    setSelectedDept(dept);
    setEditForm({ name: dept.name, status: dept.status });
    setError('');
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDept || !editForm.name.trim()) {
      setError('Department name cannot be empty.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await api.patch(`/org/departments/${selectedDept.id}`, {
        name: editForm.name.trim(),
        status: editForm.status,
      });
      setEditModalOpen(false);
      setSuccessMessage(`Department "${editForm.name}" updated successfully.`);
      await loadDepartments();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to update department.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (dept: Department) => {
    const nextStatus = dept.status === 'active' ? 'inactive' : 'active';
    try {
      setError('');
      await api.patch(`/org/departments/${dept.id}`, { status: nextStatus });
      setSuccessMessage(`Department "${dept.name}" marked as ${nextStatus}.`);
      await loadDepartments();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to toggle status.');
    }
  };

  const handleOpenDelete = (dept: Department) => {
    setSelectedDept(dept);
    setError('');
    setDeleteModalOpen(true);
  };

  const handleDeleteSubmit = async () => {
    if (!selectedDept) return;
    try {
      setSaving(true);
      setError('');
      await api.delete(`/org/departments/${selectedDept.id}`);
      setDeleteModalOpen(false);
      setSuccessMessage(`Department "${selectedDept.name}" deleted successfully.`);
      await loadDepartments();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to delete department. Active positions or staff may be assigned.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      {/* HEADER */}
      <div className="page-header">
        <div className="page-header-title">
          <h1>Departments Management</h1>
          <p>
            Configure organizational business units, delivery wings, and support departments (TECH.md §3.2).
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-secondary" onClick={loadDepartments} disabled={loading}>
            <RefreshIcon size={16} />
            <span>Refresh</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={handleOpenCreate}>
            <PlusIcon size={16} />
            <span>Add Department</span>
          </button>
        </div>
      </div>

      {/* FEEDBACK BANNERS */}
      {error && (
        <div className="alert alert-error">
          <AlertCircleIcon className="alert-icon" />
          <div>
            <strong>Action Error</strong>
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

      {/* DEPARTMENTS TABLE */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading departments list...</span>
        </div>
      ) : departments.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <DepartmentIcon size={28} />
            </div>
            <h3>No departments configured</h3>
            <p>Get started by creating your first organizational department.</p>
            <button type="button" className="btn btn-primary" style={{ marginTop: '16px' }} onClick={handleOpenCreate}>
              <PlusIcon size={16} />
              <span>Create Department</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Department Name</th>
                <th>Kind</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => (
                <tr key={dept.id}>
                  <td>
                    <code>{dept.code}</code>
                  </td>
                  <td>
                    <strong>{dept.name}</strong>
                  </td>
                  <td>
                    <span className={`badge ${dept.kind === 'delivery' ? 'badge-primary' : 'badge-neutral'}`}>
                      {dept.kind}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${dept.status === 'active' ? 'badge-active' : 'badge-inactive'}`}>
                      <span className="badge-dot" /> {dept.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleToggleStatus(dept)}
                        title={dept.status === 'active' ? 'Deactivate Department' : 'Activate Department'}
                      >
                        {dept.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>

                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => handleOpenEdit(dept)}
                        title="Edit Department"
                      >
                        <EditIcon size={15} />
                      </button>

                      <button
                        type="button"
                        className="btn-icon"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => handleOpenDelete(dept)}
                        title="Delete Department"
                      >
                        <TrashIcon size={15} />
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
        title="Add New Department"
        subtitle="Create a new functional business unit in the organization hierarchy."
      >
        <form onSubmit={handleCreateSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label>
                Department Code
                <span className="hint">Lowercase, e.g. dev, hr, sales</span>
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. eng"
                value={createForm.code}
                onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
                required
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label>Department Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Engineering"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                required
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Department Kind</label>
              <select
                className="form-control"
                value={createForm.kind}
                onChange={(e) => setCreateForm({ ...createForm, kind: e.target.value as 'support' | 'delivery' })}
                disabled={saving}
              >
                <option value="delivery">Delivery (Revenue-generating / Client-facing)</option>
                <option value="support">Support (Internal / Operational / Administrative)</option>
              </select>
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
              {saving ? 'Creating Department...' : 'Create Department'}
            </button>
          </div>
        </form>
      </Modal>

      {/* EDIT MODAL */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`Edit Department: ${selectedDept?.name}`}
        subtitle={`Code: ${selectedDept?.code}`}
      >
        <form onSubmit={handleEditSubmit}>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Department Name</label>
              <input
                type="text"
                className="form-control"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Status</label>
              <select
                className="form-control"
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value as 'active' | 'inactive' })}
                disabled={saving}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
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
              {saving ? 'Saving Changes...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Confirm Department Deletion"
        subtitle="Permanent deletion of department record"
        maxWidth="sm"
      >
        <div style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
          <p>
            Are you sure you want to delete department <strong>{selectedDept?.name}</strong> (<code>{selectedDept?.code}</code>)?
          </p>
          <p style={{ marginTop: '10px', fontSize: '13px', color: 'var(--danger-text)' }}>
            Note: Departments with active positions or staffing records cannot be deleted. If in use, deactivate the department instead.
          </p>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setDeleteModalOpen(false)}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleDeleteSubmit}
            disabled={saving}
          >
            {saving ? 'Deleting...' : 'Delete Department'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
