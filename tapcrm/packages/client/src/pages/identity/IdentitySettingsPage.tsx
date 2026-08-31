import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import Modal from '../../components/common/Modal';
import {
  ShieldIcon,
  KeyIcon,
  PinIcon,
  UsersIcon,
  RefreshIcon,
  AlertCircleIcon,
  CheckIcon,
  TrashIcon,
  PlusIcon,
} from '../../components/common/Icons';

type Tab = 'sessions' | 'mfa' | 'geofence' | 'password';

interface UserSession {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

interface MfaEnrollment {
  id: string;
  type: string;
  label: string | null;
  createdAt: string;
}

interface GeofenceLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enforceAll: boolean;
  status: string;
}

export default function IdentitySettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('sessions');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // SESSIONS
  const [sessions, setSessions] = useState<UserSession[]>([]);

  // MFA
  const [mfaEnrollments, setMfaEnrollments] = useState<MfaEnrollment[]>([]);
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [enrollData, setEnrollData] = useState<{
    secret?: string;
    uri?: string;
    recoveryCodes?: string[];
  } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');

  // GEOFENCE
  const [geofences, setGeofences] = useState<GeofenceLocation[]>([]);
  const [createGeofenceModal, setCreateGeofenceModal] = useState(false);
  const [geofenceForm, setGeofenceForm] = useState({
    name: '',
    latitude: 19.076,
    longitude: 72.8777,
    radiusMeters: 500,
    enforceAll: false,
  });

  // PASSWORD
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const loadSessions = async () => {
    try {
      setLoading(true);
      const res = await api.get<{ success: boolean; data: { sessions: UserSession[] } }>('/auth/sessions');
      setSessions(res.data.data.sessions || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to load active sessions.');
    } finally {
      setLoading(false);
    }
  };

  const loadMfa = async () => {
    try {
      setLoading(true);
      const res = await api.get<{ success: boolean; data: { enrollments: MfaEnrollment[] } }>('/auth/mfa/status');
      setMfaEnrollments(res.data.data.enrollments || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to load MFA status.');
    } finally {
      setLoading(false);
    }
  };

  const loadGeofences = async () => {
    try {
      setLoading(true);
      const res = await api.get<{ success: boolean; data: { locations: GeofenceLocation[] } }>('/identity/geofences');
      setGeofences(res.data.data.locations || []);
    } catch {
      // Might not have identity:manage-geofence permission if employee
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setError('');
    setSuccessMessage('');
    if (activeTab === 'sessions') void loadSessions();
    if (activeTab === 'mfa') void loadMfa();
    if (activeTab === 'geofence') void loadGeofences();
  }, [activeTab]);

  // SESSIONS ACTIONS
  const handleRevokeSession = async (sessionId: string) => {
    try {
      setError('');
      await api.delete(`/auth/sessions/${sessionId}`);
      setSuccessMessage('Session revoked successfully.');
      await loadSessions();
    } catch {
      setError('Failed to revoke session.');
    }
  };

  const handleRevokeOtherSessions = async () => {
    try {
      setError('');
      await api.delete('/auth/sessions');
      setSuccessMessage('All other active sessions revoked.');
      await loadSessions();
    } catch {
      setError('Failed to revoke other sessions.');
    }
  };

  // MFA ACTIONS
  const handleStartEnrollment = async () => {
    try {
      setError('');
      setLoading(true);
      const res = await api.post<{ success: boolean; data: any }>('/auth/mfa/enroll');
      setEnrollData(res.data.data);
      setConfirmCode('');
      setEnrollModalOpen(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to initiate 2FA enrollment.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollData?.secret || !confirmCode.trim()) return;

    try {
      setLoading(true);
      setError('');
      await api.post('/auth/mfa/confirm', {
        secret: enrollData.secret,
        code: confirmCode.trim(),
        recoveryCodes: enrollData.recoveryCodes || [],
        label: 'Authenticator App',
      });
      setEnrollModalOpen(false);
      setSuccessMessage('Two-Factor Authentication successfully enrolled!');
      await loadMfa();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeMfa = async (enrollmentId: string) => {
    try {
      setError('');
      await api.delete(`/auth/mfa/enrollment/${enrollmentId}`);
      setSuccessMessage('MFA method revoked.');
      await loadMfa();
    } catch {
      setError('Failed to revoke MFA method.');
    }
  };

  // GEOFENCE ACTIONS
  const handleCreateGeofence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!geofenceForm.name.trim()) return;

    try {
      setLoading(true);
      setError('');
      await api.post('/identity/geofences', {
        name: geofenceForm.name.trim(),
        latitude: Number(geofenceForm.latitude),
        longitude: Number(geofenceForm.longitude),
        radiusMeters: Number(geofenceForm.radiusMeters),
        enforceAll: geofenceForm.enforceAll,
      });
      setCreateGeofenceModal(false);
      setSuccessMessage(`Geofence location "${geofenceForm.name}" created.`);
      await loadGeofences();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to create geofence.');
    } finally {
      setLoading(false);
    }
  };

  // PASSWORD ACTIONS
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (passwordForm.newPassword.length < 12) {
      setError('Password must be at least 12 characters long (ID-3 Security Policy).');
      return;
    }

    try {
      setLoading(true);
      setError('');
      await api.post('/auth/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSuccessMessage('Password changed successfully.');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      {/* HEADER */}
      <div className="page-header">
        <div className="page-header-title">
          <h1>Identity, Access & Security Settings</h1>
          <p>
            Manage active sessions, multi-factor authentication, physical geofence boundaries, and credential security.
          </p>
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

      {/* SUB-TABS */}
      <div className="card" style={{ marginBottom: '24px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'sessions' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('sessions')}
          >
            <ShieldIcon size={14} />
            <span>Active Sessions</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'mfa' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('mfa')}
          >
            <KeyIcon size={14} />
            <span>Two-Factor Auth (MFA)</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'geofence' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('geofence')}
          >
            <PinIcon size={14} />
            <span>Geofenced Logins</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'password' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('password')}
          >
            <KeyIcon size={14} />
            <span>Password & Security</span>
          </button>
        </div>
      </div>

      {/* TAB 1: SESSIONS */}
      {activeTab === 'sessions' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Active Devices & Sessions</h2>
              <p className="card-subtitle">
                Manage your authenticated sessions across web browsers and devices (PRD ID-8).
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={handleRevokeOtherSessions}
              disabled={loading || sessions.length <= 1}
            >
              Revoke All Other Sessions
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {sessions.map((sess) => (
              <div
                key={sess.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                  background: sess.isCurrent ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      background: sess.isCurrent ? 'var(--primary)' : 'var(--bg-muted)',
                      color: sess.isCurrent ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    <ShieldIcon size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 650, fontSize: '14px', color: 'var(--text-primary)' }}>
                      {sess.userAgent || 'Web Browser'}
                      {sess.isCurrent && (
                        <span className="badge badge-success" style={{ marginLeft: '8px' }}>
                          Current Session
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      IP: {sess.ipAddress || '127.0.0.1'} • Signed in: {new Date(sess.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>

                {!sess.isCurrent && (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => handleRevokeSession(sess.id)}
                  >
                    <TrashIcon size={14} />
                    <span>Revoke</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: MFA */}
      {activeTab === 'mfa' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Two-Factor Authentication (MFA)</h2>
              <p className="card-subtitle">
                Time-based One-Time Password (TOTP) and Recovery Codes protection (PRD ID-4).
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStartEnrollment}
              disabled={loading}
            >
              <PlusIcon size={16} />
              <span>Enroll Authenticator</span>
            </button>
          </div>

          {mfaEnrollments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <KeyIcon size={28} />
              </div>
              <h3>No 2FA methods enrolled</h3>
              <p>Enhance your account security by linking an authenticator app (Google Authenticator, Authy, etc.).</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {mfaEnrollments.map((enr) => (
                <div
                  key={enr.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-default)',
                    background: 'var(--bg-surface)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ padding: '10px', borderRadius: 'var(--radius-sm)', background: 'var(--success-subtle)', color: 'var(--success)' }}>
                      <CheckIcon size={20} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 650, color: 'var(--text-primary)' }}>
                        {enr.label || 'Authenticator App (TOTP)'}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Enrolled on {new Date(enr.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => handleRevokeMfa(enr.id)}
                  >
                    <TrashIcon size={14} />
                    <span>Revoke</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: GEOFENCE */}
      {activeTab === 'geofence' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Geofence Access Boundaries</h2>
              <p className="card-subtitle">
                Geographic perimeter login policies for restricted access roles (PRD ID-15).
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreateGeofenceModal(true)}
            >
              <PlusIcon size={16} />
              <span>Add Location</span>
            </button>
          </div>

          {geofences.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <PinIcon size={28} />
              </div>
              <h3>No geofenced locations</h3>
              <p>Configure headquarters or regional office coordinates to restrict or mandate on-premise logins.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Location Name</th>
                    <th>Coordinates (Lat, Lng)</th>
                    <th>Radius</th>
                    <th>Scope</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {geofences.map((geo) => (
                    <tr key={geo.id}>
                      <td><strong>{geo.name}</strong></td>
                      <td><code>{geo.latitude.toFixed(4)}, {geo.longitude.toFixed(4)}</code></td>
                      <td>{geo.radiusMeters} meters</td>
                      <td>
                        <span className={`badge ${geo.enforceAll ? 'badge-danger' : 'badge-neutral'}`}>
                          {geo.enforceAll ? 'All Users' : 'Assigned Only'}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-active">{geo.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PASSWORD */}
      {activeTab === 'password' && (
        <div className="card" style={{ maxWidth: '640px' }}>
          <div className="card-header">
            <div>
              <h2 className="card-title">Change Password</h2>
              <p className="card-subtitle">
                Password must be at least 12 characters and will be salted using Argon2id (PRD ID-2).
              </p>
            </div>
          </div>

          <form onSubmit={handleChangePassword}>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
              <div className="form-group">
                <label>Current Password</label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="Enter current password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>
                  New Password
                  <span className="hint">Minimum 12 characters</span>
                </label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="Enter new strong password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="Re-enter new password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Updating Password...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MFA ENROLLMENT MODAL */}
      <Modal
        isOpen={enrollModalOpen}
        onClose={() => setEnrollModalOpen(false)}
        title="Set Up Two-Factor Authentication"
        subtitle="Scan the QR key or manually enter secret into your authenticator application."
        maxWidth="md"
      >
        <form onSubmit={handleConfirmMfa}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '14px', background: 'var(--bg-surface-hover)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Manual Setup Key:</div>
              <code style={{ fontSize: '15px', fontWeight: 700, color: 'var(--primary-text)', wordBreak: 'break-all', display: 'block', marginTop: '4px' }}>
                {enrollData?.secret || 'Generating...'}
              </code>
            </div>

            {enrollData?.recoveryCodes && enrollData.recoveryCodes.length > 0 && (
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                  Save your Emergency Recovery Codes:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', padding: '10px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)' }}>
                  {enrollData.recoveryCodes.map((c, i) => (
                    <code key={i} style={{ fontSize: '12px' }}>{c}</code>
                  ))}
                </div>
              </div>
            )}

            <div className="form-group">
              <label>6-Digit Verification Code</label>
              <input
                type="text"
                className="form-control"
                placeholder="123456"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                maxLength={6}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEnrollModalOpen(false)}
              disabled={loading}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Verifying...' : 'Confirm & Enable 2FA'}
            </button>
          </div>
        </form>
      </Modal>

      {/* CREATE GEOFENCE MODAL */}
      <Modal
        isOpen={createGeofenceModal}
        onClose={() => setCreateGeofenceModal(false)}
        title="Add Geofenced Location"
        subtitle="Specify center coordinates and boundary radius in meters."
      >
        <form onSubmit={handleCreateGeofence}>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Location Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Headquarters Office, Tech Park"
                value={geofenceForm.name}
                onChange={(e) => setGeofenceForm({ ...geofenceForm, name: e.target.value })}
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Latitude</label>
              <input
                type="number"
                step="0.0001"
                className="form-control"
                value={geofenceForm.latitude}
                onChange={(e) => setGeofenceForm({ ...geofenceForm, latitude: parseFloat(e.target.value) })}
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Longitude</label>
              <input
                type="number"
                step="0.0001"
                className="form-control"
                value={geofenceForm.longitude}
                onChange={(e) => setGeofenceForm({ ...geofenceForm, longitude: parseFloat(e.target.value) })}
                required
                disabled={loading}
              />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Radius (Meters)</label>
              <input
                type="number"
                min="50"
                max="10000"
                className="form-control"
                value={geofenceForm.radiusMeters}
                onChange={(e) => setGeofenceForm({ ...geofenceForm, radiusMeters: parseInt(e.target.value, 10) || 500 })}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreateGeofenceModal(false)}
              disabled={loading}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Save Location'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
