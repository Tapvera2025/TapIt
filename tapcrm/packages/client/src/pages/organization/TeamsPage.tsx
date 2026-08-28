import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import Modal from '../../components/common/Modal';
import {
  TeamsIcon,
  PlusIcon,
  EditIcon,
  UsersIcon,
  RefreshIcon,
  AlertCircleIcon,
  CheckIcon,
} from '../../components/common/Icons';

interface Team {
  id: string;
  departmentId: string;
  kind: 'sales-team' | 'sales-pool' | 'dev-subteam';
  name: string;
  leadUserId: string | null;
  parentTeamId: string | null;
  sharedVisibility: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Department {
  id: string;
  code: string;
  name: string;
}

interface OrgEmployee {
  id: string;
  fullName: string;
  email: string;
  departmentId: string | null;
  teamId: string | null;
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<OrgEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [saving, setSaving] = useState(false);

  // Forms
  const [createForm, setCreateForm] = useState<{
    departmentId: string;
    kind: 'sales-team' | 'sales-pool' | 'dev-subteam';
    name: string;
    parentTeamId: string;
    sharedVisibility: boolean;
  }>({
    departmentId: '',
    kind: 'dev-subteam',
    name: '',
    parentTeamId: '',
    sharedVisibility: false,
  });

  const [editForm, setEditForm] = useState<{
    kind: 'sales-team' | 'sales-pool' | 'dev-subteam';
    name: string;
    sharedVisibility: boolean;
  }>({
    kind: 'dev-subteam',
    name: '',
    sharedVisibility: false,
  });

  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [teamRes, deptRes, chartRes] = await Promise.all([
        api.get<{ success: boolean; data: Team[] }>('/org/teams'),
        api.get<{ success: boolean; data: Department[] }>('/org/departments'),
        api.get<{ success: boolean; data: OrgEmployee[] }>('/org/chart'),
      ]);
      setTeams(teamRes.data.data || []);
      setDepartments(deptRes.data.data || []);
      setEmployees(chartRes.data.data || []);

      if (deptRes.data.data?.length && !createForm.departmentId) {
        setCreateForm((f) => ({ ...f, departmentId: deptRes.data.data[0]!.id }));
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Unable to load teams.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleOpenCreate = () => {
    setCreateForm({
      departmentId: departments[0]?.id || '',
      kind: 'dev-subteam',
      name: '',
      parentTeamId: '',
      sharedVisibility: false,
    });
    setError('');
    setCreateModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.departmentId) {
      setError('Department and Team Name are required.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await api.post('/org/teams', {
        departmentId: createForm.departmentId,
        kind: createForm.kind,
        name: createForm.name.trim(),
        parentTeamId: createForm.parentTeamId || null,
        sharedVisibility: createForm.sharedVisibility,
      });
      setCreateModalOpen(false);
      setSuccessMessage(`Team "${createForm.name}" created successfully.`);
      await loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to create team.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEdit = (team: Team) => {
    setSelectedTeam(team);
    setEditForm({
      kind: team.kind,
      name: team.name,
      sharedVisibility: team.sharedVisibility,
    });
    setError('');
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeam || !editForm.name.trim()) return;

    try {
      setSaving(true);
      setError('');
      await api.patch(`/org/teams/${selectedTeam.id}`, {
        name: editForm.name.trim(),
        kind: editForm.kind,
        sharedVisibility: editForm.sharedVisibility,
      });
      setEditModalOpen(false);
      setSuccessMessage(`Team "${editForm.name}" updated successfully.`);
      await loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to update team.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenMembers = (team: Team) => {
    setSelectedTeam(team);
    // Find current members of this team
    const currentMembers = employees.filter((emp) => emp.teamId === team.id).map((e) => e.id);
    setSelectedMemberIds(currentMembers);
    setError('');
    setMembersModalOpen(true);
  };

  const handleMembersSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeam) return;

    if (selectedMemberIds.length === 0) {
      setError('Please select at least one employee to assign to this team.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await api.post(`/org/teams/${selectedTeam.id}/members`, {
        userIds: selectedMemberIds,
      });
      setMembersModalOpen(false);
      setSuccessMessage(`Updated team members for "${selectedTeam.name}".`);
      await loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to update team members.');
    } finally {
      setSaving(false);
    }
  };

  const toggleMemberSelection = (userId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  return (
    <div className="page-container">
      {/* HEADER */}
      <div className="page-header">
        <div className="page-header-title">
          <h1>Teams & Sub-Teams Management</h1>
          <p>
            Configure organizational sub-units, functional teams, sales pools, and membership boundaries (PRD §3.5).
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-secondary" onClick={loadData} disabled={loading}>
            <RefreshIcon size={16} />
            <span>Refresh</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={handleOpenCreate}>
            <PlusIcon size={16} />
            <span>Add Team</span>
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

      {/* TEAMS LIST */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading teams...</span>
        </div>
      ) : teams.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <TeamsIcon size={28} />
            </div>
            <h3>No teams configured</h3>
            <p>Create functional teams and subteams to group employees and manage data visibility.</p>
            <button type="button" className="btn btn-primary" style={{ marginTop: '16px' }} onClick={handleOpenCreate}>
              <PlusIcon size={16} />
              <span>Create Team</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Team Name</th>
                <th>Department</th>
                <th>Kind</th>
                <th>Visibility</th>
                <th>Current Members</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const dept = departments.find((d) => d.id === team.departmentId);
                const memberCount = employees.filter((e) => e.teamId === team.id).length;
                return (
                  <tr key={team.id}>
                    <td>
                      <strong>{team.name}</strong>
                    </td>
                    <td>{dept?.name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td>
                      <span
                        className={`badge ${
                          team.kind === 'dev-subteam'
                            ? 'badge-primary'
                            : team.kind === 'sales-team'
                              ? 'badge-info'
                              : 'badge-warning'
                        }`}
                      >
                        {team.kind.replace('-', ' ')}
                      </span>
                    </td>
                    <td>
                      {team.sharedVisibility ? (
                        <span className="badge badge-success">Shared</span>
                      ) : (
                        <span className="badge badge-neutral">Private</span>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-neutral">
                        <UsersIcon size={12} /> {memberCount} {memberCount === 1 ? 'member' : 'members'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleOpenMembers(team)}
                          title="Manage Members"
                        >
                          <UsersIcon size={14} />
                          <span>Members</span>
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => handleOpenEdit(team)}
                          title="Edit Team"
                        >
                          <EditIcon size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* CREATE MODAL */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Add New Team"
        subtitle="Create an organizational sub-team, sales group, or pool."
      >
        <form onSubmit={handleCreateSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label>Department</label>
              <select
                className="form-control"
                value={createForm.departmentId}
                onChange={(e) => setCreateForm({ ...createForm, departmentId: e.target.value })}
                required
                disabled={saving}
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Team Kind</label>
              <select
                className="form-control"
                value={createForm.kind}
                onChange={(e) => setCreateForm({ ...createForm, kind: e.target.value as any })}
                disabled={saving}
              >
                <option value="dev-subteam">Development Subteam (dev-subteam)</option>
                <option value="sales-team">Sales Team (sales-team)</option>
                <option value="sales-pool">Sales Pool (sales-pool)</option>
              </select>
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Team Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Frontend Engineering, Enterprise Accounts"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                required
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={createForm.sharedVisibility}
                  onChange={(e) => setCreateForm({ ...createForm, sharedVisibility: e.target.checked })}
                  disabled={saving}
                />
                <span>Enable Shared Lateral Visibility (Members can view peers&apos; deals/tasks)</span>
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
              {saving ? 'Creating Team...' : 'Create Team'}
            </button>
          </div>
        </form>
      </Modal>

      {/* EDIT MODAL */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`Edit Team: ${selectedTeam?.name}`}
        subtitle="Update team configuration and lateral access."
      >
        <form onSubmit={handleEditSubmit}>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Team Name</label>
              <input
                type="text"
                className="form-control"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label>Team Kind</label>
              <select
                className="form-control"
                value={editForm.kind}
                onChange={(e) => setEditForm({ ...editForm, kind: e.target.value as any })}
                disabled={saving}
              >
                <option value="dev-subteam">Development Subteam</option>
                <option value="sales-team">Sales Team</option>
                <option value="sales-pool">Sales Pool</option>
              </select>
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editForm.sharedVisibility}
                  onChange={(e) => setEditForm({ ...editForm, sharedVisibility: e.target.checked })}
                  disabled={saving}
                />
                <span>Enable Shared Lateral Visibility</span>
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
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MANAGE MEMBERS MODAL */}
      <Modal
        isOpen={membersModalOpen}
        onClose={() => setMembersModalOpen(false)}
        title={`Assign Members to: ${selectedTeam?.name}`}
        subtitle="Select employees in this department to assign to the team."
        maxWidth="lg"
      >
        <form onSubmit={handleMembersSubmit}>
          <div style={{ maxHeight: '360px', overflowY: 'auto', marginBottom: '16px' }}>
            {employees.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px' }}>
                <p>No active employees found to assign.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                {employees.map((emp) => {
                  const isChecked = selectedMemberIds.includes(emp.id);
                  const isCurrentTeam = emp.teamId === selectedTeam?.id;
                  return (
                    <div
                      key={emp.id}
                      onClick={() => toggleMemberSelection(emp.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                        borderRadius: 'var(--radius-md)',
                        border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border-default)',
                        background: isChecked ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}} // Handled by parent container click
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                          {emp.fullName}
                        </div>
                        {emp.email && (
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {emp.email}
                          </div>
                        )}
                        {isCurrentTeam && (
                          <span className="badge badge-success" style={{ marginTop: '4px', fontSize: '10.5px' }}>
                            Current Member
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setMembersModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Updating Roster...' : `Save (${selectedMemberIds.length} Members)`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
