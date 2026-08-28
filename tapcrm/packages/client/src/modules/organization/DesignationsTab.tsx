import { useEffect, useState } from 'react';
import api from '../../lib/api';

interface Designation {
  id: string;
  name: string;
  specializations: string[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export default function DesignationsTab() {
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<{
    name: string;
    specializationsStr: string;
  }>({
    name: '',
    specializationsStr: '',
  });

  const loadDesignations = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get<ApiResponse<Designation[]>>('/org/designations');
      setDesignations(res.data.data);
    } catch {
      setError('Unable to load designations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDesignations();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Designation name is required.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      const specs = form.specializationsStr
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      await api.post('/org/designations', {
        name: form.name.trim(),
        specializations: specs,
      });

      setForm({ name: '', specializationsStr: '' });
      setShowCreate(false);
      await loadDesignations();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to create designation.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-tab-content">
      <div className="tab-header">
        <div>
          <h3>Designations & Specializations</h3>
          <p>Configurable titles and skill specializations (PRD §4.2, OR-11).</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? '✕ Cancel' : '+ Add Designation'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showCreate && (
        <form className="card form-card" onSubmit={handleCreate}>
          <h4>Create New Designation</h4>
          <div className="form-grid">
            <div className="form-group">
              <label>Designation Title</label>
              <input
                type="text"
                placeholder="e.g. Senior Software Engineer"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label>Specializations (comma-separated)</label>
              <input
                type="text"
                placeholder="e.g. Frontend, React, Backend, Node.js"
                value={form.specializationsStr}
                onChange={(e) => setForm({ ...form, specializationsStr: e.target.value })}
                disabled={saving}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Creating...' : 'Save Designation'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="loading-state">Loading designations...</div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Designation Title</th>
                <th>Specializations</th>
              </tr>
            </thead>
            <tbody>
              {designations.map((desig) => (
                <tr key={desig.id}>
                  <td><strong>{desig.name}</strong></td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {desig.specializations && desig.specializations.length > 0 ? (
                        desig.specializations.map((spec) => (
                          <span key={spec} className="badge badge-specialization">
                            {spec}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>None</span>
                      )}
                    </div>
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
