import { useEffect, useState } from 'react';
import api from '../../lib/api';

interface Team {
  id: string;
  departmentId: string;
  kind: 'sales-team' | 'sales-pool' | 'dev-subteam';
  name: string;
  leadUserId: string | null;
  parentTeamId: string | null;
  sharedVisibility: boolean;
}

interface Department {
  id: string;
  code: string;
  name: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export default function TeamsTab() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<{
    departmentId: string;
    kind: 'sales-team' | 'sales-pool' | 'dev-subteam';
    name: string;
    parentTeamId: string | null;
  }>({
    departmentId: '',
    kind: 'dev-subteam',
    name: '',
    parentTeamId: null,
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [teamRes, deptRes] = await Promise.all([
        api.get<ApiResponse<Team[]>>('/org/teams'),
        api.get<ApiResponse<Department[]>>('/org/departments'),
      ]);
      setTeams(teamRes.data.data);
      setDepartments(deptRes.data.data);
      if (deptRes.data.data.length > 0 && !form.departmentId) {
        setForm((f) => ({ ...f, departmentId: deptRes.data.data[0]!.id }));
      }
    } catch {
      setError('Unable to load teams.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.departmentId) {
      setError('Department and Name are required.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await api.post('/org/teams', {
        departmentId: form.departmentId,
        kind: form.kind,
        name: form.name.trim(),
        parentTeamId: form.parentTeamId || null,
      });
      setForm({
        departmentId: departments[0]?.id || '',
        kind: 'dev-subteam',
        name: '',
        parentTeamId: null,
      });
      setShowCreate(false);
      await loadData();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to create team.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-tab-content">
      <div className="tab-header">
        <div>
          <h3>Teams & Sub-Teams</h3>
          <p>Organizational units that bound lateral visibility (PRD §3.5).</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? '✕ Cancel' : '+ Add Team'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showCreate && (
        <form className="card form-card" onSubmit={handleCreate}>
          <h4>Create New Team</h4>
          <div className="form-grid">
            <div className="form-group">
              <label>Department</label>
              <select
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
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
              <label>Kind</label>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as any })}
                disabled={saving}
              >
                <option value="dev-subteam">Development Subteam</option>
                <option value="sales-team">Sales Team</option>
                <option value="sales-pool">Sales Pool</option>
              </select>
            </div>
            <div className="form-group">
              <label>Team Name</label>
              <input
                type="text"
                placeholder="e.g. Frontend Team, Enterprise Sales"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={saving}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Creating...' : 'Save Team'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="loading-state">Loading teams...</div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Team Name</th>
                <th>Kind</th>
                <th>Department</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const dept = departments.find((d) => d.id === team.departmentId);
                return (
                  <tr key={team.id}>
                    <td><strong>{team.name}</strong></td>
                    <td>
                      <span className={`badge badge-team-${team.kind}`}>{team.kind}</span>
                    </td>
                    <td>{dept?.name || team.departmentId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
