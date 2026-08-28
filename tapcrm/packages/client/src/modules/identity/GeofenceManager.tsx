import { useEffect, useState } from 'react';
import api from '../../lib/api';

interface GeofenceLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
  createdAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export default function GeofenceManager() {
  const [locations, setLocations] = useState<GeofenceLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<{
    name: string;
    latitude: number;
    longitude: number;
    radiusMetres: number;
  }>({
    name: '',
    latitude: 19.076,
    longitude: 72.8777,
    radiusMetres: 200,
  });

  const loadLocations = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get<ApiResponse<{ locations: GeofenceLocation[] }>>('/identity/geofences');
      setLocations(res.data.data.locations || []);
    } catch {
      setError('Unable to load geofence locations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLocations();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Location name is required.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await api.post('/identity/geofences', {
        name: form.name.trim(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        radiusMetres: Number(form.radiusMetres),
      });
      setSuccess('Geofence location created.');
      setForm({ name: '', latitude: 19.076, longitude: 72.8777, radiusMetres: 200 });
      setShowCreate(false);
      await loadLocations();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to create geofence location.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-tab-content">
      <div className="tab-header">
        <div>
          <h3>Geofenced Login Locations</h3>
          <p>Shared location perimeters for friction control login policy (PRD §8.1, ID-13..ID-18b).</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? '✕ Cancel' : '+ Add Office Location'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {showCreate && (
        <form className="card form-card" onSubmit={handleCreate}>
          <h4>Add Geofenced Location</h4>
          <div className="form-grid">
            <div className="form-group">
              <label>Location Name</label>
              <input
                type="text"
                placeholder="e.g. Headquarters, Downtown Office"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label>Latitude</label>
              <input
                type="number"
                step="0.000001"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: parseFloat(e.target.value) })}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label>Longitude</label>
              <input
                type="number"
                step="0.000001"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: parseFloat(e.target.value) })}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label>Radius (Metres)</label>
              <input
                type="number"
                min="10"
                max="5000"
                value={form.radiusMetres}
                onChange={(e) => setForm({ ...form, radiusMetres: parseInt(e.target.value, 10) })}
                disabled={saving}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Location'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="loading-state">Loading geofences...</div>
      ) : locations.length === 0 ? (
        <div className="empty-state card">
          <p>No geofence perimeters configured. Users may log in from any location unless fenced.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Location Name</th>
                <th>Coordinates</th>
                <th>Allowed Radius</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => (
                <tr key={loc.id}>
                  <td><strong>{loc.name}</strong></td>
                  <td><code>{loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}</code></td>
                  <td>
                    <span className="badge badge-level">±{loc.radiusMetres}m</span>
                  </td>
                  <td>{new Date(loc.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
