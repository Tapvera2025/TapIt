import { useEffect, useState } from 'react';
import api from '../../lib/api';

interface UserSession {
  id: string;
  deviceLabel: string | null;
  ip: string | null;
  approxLocation: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export default function SessionsManager() {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadSessions = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get<ApiResponse<{ sessions: UserSession[] }>>('/auth/sessions');
      setSessions(res.data.data.sessions || []);
    } catch {
      setError('Unable to load active sessions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  const handleRevokeSingle = async (sessionId: string) => {
    try {
      setError('');
      setSuccess('');
      await api.delete(`/auth/sessions/${sessionId}`);
      setSuccess('Session revoked successfully.');
      await loadSessions();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to revoke session.');
    }
  };

  const handleRevokeOther = async () => {
    if (!confirm('Are you sure you want to sign out all other devices and sessions?')) return;
    try {
      setError('');
      setSuccess('');
      await api.delete('/auth/sessions');
      setSuccess('All other sessions revoked.');
      await loadSessions();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to revoke other sessions.');
    }
  };

  return (
    <div className="module-tab-content">
      <div className="tab-header">
        <div>
          <h3>Active Sessions & Devices</h3>
          <p>Inspect sign-in sessions and terminate active sessions across devices (PRD §8.1, ID-8).</p>
        </div>
        {sessions.length > 1 && (
          <button className="btn-secondary" onClick={handleRevokeOther}>
            Revoke All Other Sessions
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <div className="loading-state">Loading active sessions...</div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Device / Client</th>
                <th>IP Address</th>
                <th>Approx. Location</th>
                <th>Last Active</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} style={s.isCurrent ? { background: 'rgba(99, 102, 241, 0.05)' } : undefined}>
                  <td>
                    <strong>{s.deviceLabel || 'Web Browser'}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748b)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.userAgent}
                    </div>
                  </td>
                  <td><code>{s.ip || 'Unknown'}</code></td>
                  <td>{s.approxLocation || 'Unknown Location'}</td>
                  <td>{new Date(s.lastActiveAt).toLocaleString()}</td>
                  <td>
                    {s.isCurrent ? (
                      <span className="badge badge-primary">Current Session</span>
                    ) : (
                      <span className="badge status-active">Active</span>
                    )}
                  </td>
                  <td>
                    {!s.isCurrent && (
                      <button className="btn-sm btn-danger" onClick={() => handleRevokeSingle(s.id)}>
                        Revoke
                      </button>
                    )}
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
