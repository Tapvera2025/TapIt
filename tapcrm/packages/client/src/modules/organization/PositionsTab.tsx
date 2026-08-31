import { useEffect, useState } from 'react';
import api from '../../lib/api';

interface Position {
  id: string;
  departmentId: string;
  departmentName?: string;
  code: string;
  name: string;
  organizationalLevel: number;
  parentPositionId: string | null;
  status: 'active' | 'inactive';
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

export default function PositionsTab() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<{
    departmentId: string;
    code: string;
    name: string;
    organizationalLevel: number;
    parentPositionId: string | null;
  }>({
    departmentId: '',
    code: '',
    name: '',
    organizationalLevel: 25,
    parentPositionId: null,
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [posRes, deptRes] = await Promise.all([
        api.get<ApiResponse<Position[]>>('/org/positions'),
        api.get<ApiResponse<Department[]>>('/org/departments'),
      ]);
      setPositions(posRes.data.data);
      setDepartments(deptRes.data.data);
      if (deptRes.data.data.length > 0 && !form.departmentId) {
        setForm((f) => ({ ...f, departmentId: deptRes.data.data[0]!.id }));
      }
    } catch {
      setError('Unable to load positions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim() || !form.departmentId) {
      setError('Department, Code, and Name are required.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await api.post('/org/positions', {
        departmentId: form.departmentId,
        code: form.code.trim(),
        name: form.name.trim(),
        organizationalLevel: Number(form.organizationalLevel),
        parentPositionId: form.parentPositionId || null,
      });
      setForm({
        departmentId: departments[0]?.id || '',
        code: '',
        name: '',
        organizationalLevel: 25,
        parentPositionId: null,
      });
      setShowCreate(false);
      await loadData();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to create position.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-tab-content">
      <div className="tab-header">
        <div>
          <h3>Positions & Authority Ladder</h3>
          <p>Units of authority that hold permission policies (PRD §4.3).</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? '✕ Cancel' : '+ Add Position'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showCreate && (
        <form className="card form-card" onSubmit={handleCreate}>
          <h4>Create New Position</h4>
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
              <label>Position Code</label>
              <input
                type="text"
                placeholder="e.g. dev-lead, pm"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label>Position Title</label>
              <input
                type="text"
                placeholder="e.g. Lead Engineer, Project Manager"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label>Organizational Level (1-100)</label>
              <input
                type="number"
                min="1"
                max="100"
                value={form.organizationalLevel}
                onChange={(e) =>
                  setForm({ ...form, organizationalLevel: parseInt(e.target.value, 10) })
                }
                disabled={saving}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Position'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="loading-state">Loading positions ladder...</div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Title</th>
                <th>Department</th>
                <th>Level</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const dept = departments.find((d) => d.id === pos.departmentId);
                return (
                  <tr key={pos.id}>
                    <td><code>{pos.code}</code></td>
                    <td><strong>{pos.name}</strong></td>
                    <td>{dept?.name || pos.departmentId}</td>
                    <td>
                      <span className="badge badge-level">Level {pos.organizationalLevel}</span>
                    </td>
                    <td>
                      <span className={`badge status-${pos.status}`}>{pos.status}</span>
                    </td>
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
