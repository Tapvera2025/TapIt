import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import Modal from '../../components/common/Modal';
import {
  DesignationIcon,
  PlusIcon,
  EditIcon,
  TrashIcon,
  RefreshIcon,
  AlertCircleIcon,
  CheckIcon,
} from '../../components/common/Icons';

interface Designation {
  id: string;
  name: string;
  specializations: string[];
  createdAt: string;
  updatedAt: string;
}

export default function DesignationsPage() {
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedDesig, setSelectedDesig] = useState<Designation | null>(null);
  const [saving, setSaving] = useState(false);

  // Forms
  const [createForm, setCreateForm] = useState({
    name: '',
    specializationsStr: '',
  });

  const [editForm, setEditForm] = useState({
    name: '',
    specializationsStr: '',
  });

  const loadDesignations = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get<{ success: boolean; data: Designation[] }>('/org/designations');
      setDesignations(res.data.data || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Unable to load designations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDesignations();
  }, []);

  const handleOpenCreate = () => {
    setCreateForm({ name: '', specializationsStr: '' });
    setError('');
    setCreateModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) {
      setError('Designation title is required.');
      return;
    }

    const specializations = createForm.specializationsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      setSaving(true);
      setError('');
      await api.post('/org/designations', {
        name: createForm.name.trim(),
        specializations,
      });
      setCreateModalOpen(false);
      setSuccessMessage(`Designation "${createForm.name}" created successfully.`);
      await loadDesignations();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to create designation.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEdit = (desig: Designation) => {
    setSelectedDesig(desig);
    setEditForm({
      name: desig.name,
      specializationsStr: desig.specializations?.join(', ') || '',
    });
    setError('');
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDesig || !editForm.name.trim()) return;

    const specializations = editForm.specializationsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      setSaving(true);
      setError('');
      await api.patch(`/org/designations/${selectedDesig.id}`, {
        name: editForm.name.trim(),
        specializations,
      });
      setEditModalOpen(false);
      setSuccessMessage(`Designation "${editForm.name}" updated successfully.`);
      await loadDesignations();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to update designation.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenDelete = (desig: Designation) => {
    setSelectedDesig(desig);
    setError('');
    setDeleteModalOpen(true);
  };

  const handleDeleteSubmit = async () => {
    if (!selectedDesig) return;
    try {
      setSaving(true);
      setError('');
      await api.delete(`/org/designations/${selectedDesig.id}`);
      setDeleteModalOpen(false);
      setSuccessMessage(`Designation "${selectedDesig.name}" deleted.`);
      await loadDesignations();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to delete designation.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      {/* HEADER */}
      <div className="page-header">
        <div className="page-header-title">
          <h1>Designations & Skill Specializations</h1>
          <p>
            Titles and skill tags assigned to staff members independently from authority positions (PRD §4.2).
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-secondary" onClick={loadDesignations} disabled={loading}>
            <RefreshIcon size={16} />
            <span>Refresh</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={handleOpenCreate}>
            <PlusIcon size={16} />
            <span>Add Designation</span>
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

      {/* DESIGNATIONS LIST */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading designations...</span>
        </div>
      ) : designations.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <DesignationIcon size={28} />
            </div>
            <h3>No designations configured</h3>
            <p>Designations describe professional job titles and technical specializations.</p>
            <button type="button" className="btn btn-primary" style={{ marginTop: '16px' }} onClick={handleOpenCreate}>
              <PlusIcon size={16} />
              <span>Create Designation</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Designation Title</th>
                <th>Skill Specializations</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {designations.map((desig) => (
                <tr key={desig.id}>
                  <td>
                    <strong>{desig.name}</strong>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {desig.specializations && desig.specializations.length > 0 ? (
                        desig.specializations.map((spec) => (
                          <span key={spec} className="badge badge-info">
                            {spec}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>None specified</span>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => handleOpenEdit(desig)}
                        title="Edit Designation"
                      >
                        <EditIcon size={15} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => handleOpenDelete(desig)}
                        title="Delete Designation"
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
        title="Add New Designation"
        subtitle="Create a title and define applicable specializations."
      >
        <form onSubmit={handleCreateSubmit}>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Designation Title</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Senior Software Engineer"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                required
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>
                Skill Specializations
                <span className="hint">Comma-separated list</span>
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Frontend, React, Backend, Node.js, QA"
                value={createForm.specializationsStr}
                onChange={(e) => setCreateForm({ ...createForm, specializationsStr: e.target.value })}
                disabled={saving}
              />
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
              {saving ? 'Creating...' : 'Create Designation'}
            </button>
          </div>
        </form>
      </Modal>

      {/* EDIT MODAL */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`Edit Designation: ${selectedDesig?.name}`}
        subtitle="Update designation title and skill specializations."
      >
        <form onSubmit={handleEditSubmit}>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Designation Title</label>
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
              <label>
                Skill Specializations
                <span className="hint">Comma-separated list</span>
              </label>
              <input
                type="text"
                className="form-control"
                value={editForm.specializationsStr}
                onChange={(e) => setEditForm({ ...editForm, specializationsStr: e.target.value })}
                disabled={saving}
              />
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
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* DELETE MODAL */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Confirm Designation Deletion"
        subtitle={`Delete "${selectedDesig?.name}"`}
        maxWidth="sm"
      >
        <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', lineHeight: 1.5 }}>
          Are you sure you want to delete this designation? Staff currently assigned to this designation will have their designation cleared.
        </p>

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
            {saving ? 'Deleting...' : 'Delete Designation'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
