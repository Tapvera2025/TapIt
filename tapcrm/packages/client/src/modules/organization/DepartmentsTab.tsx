import { useEffect, useState } from 'react';
import api from '../../lib/api';

interface Department {
  id: string;
  code: string;
  name: string;
  kind: 'support' | 'delivery';
  status: 'active' | 'inactive';
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export default function DepartmentsTab() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<{
    code: string;
    name: string;
    kind: 'support' | 'delivery';
  }>({
    code: '',
    name: '',
    kind: 'support',
  });

  const loadDepartments = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get<ApiResponse<Department[]>>('/org/departments');
      setDepartments(res.data.data);
    } catch (err: unknown) {
      setError('Unable to load departments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDepartments();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      setError('Code and Name are required.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await api.post('/org/departments', form);
      setForm({ code: '', name: '', kind: 'support' });
      setShowCreate(false);
      await loadDepartments();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to create department.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (dept: Department) => {
    try {
      const nextStatus = dept.status === 'active' ? 'inactive' : 'active';
      await api.patch(`/org/departments/${dept.id}`, { status: nextStatus });
      await loadDepartments();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to update department status.');
    }
  };

  return (
    <div className="module-tab-content">
      <div className="tab-header">
        <div>
          <h3>Departments</h3>
          <p>Manage organizational business units and support functions.</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? '✕ Cancel' : '+ Add Department'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showCreate && (
        <form className="card form-card" onSubmit={handleCreate}>
          <h4>Create New Department</h4>
          <div className="form-grid">
            <div className="form-group">
              <label>Department Code</label>
              <input
                type="text"
                placeholder="e.g. eng, hr, sales"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label>Department Name</label>
              <input
                type="text"
                placeholder="e.g. Engineering, Sales"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label>Kind</label>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as any })}
                disabled={saving}
              >
                <option value="support">Support</option>
                <option value="delivery">Delivery</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Creating...' : 'Save Department'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="loading-state">Loading departments...</div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => (
                <tr key={dept.id}>
                  <td><strong>{dept.code}</strong></td>
                  <td>{dept.name}</td>
                  <td>
                    <span className={`badge badge-${dept.kind}`}>{dept.kind}</span>
                  </td>
                  <td>
                    <span className={`badge status-${dept.status}`}>{dept.status}</span>
                  </td>
                  <td>
                    <button
                      className="btn-sm btn-secondary"
                      onClick={() => void handleToggleStatus(dept)}
                    >
                      {dept.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
