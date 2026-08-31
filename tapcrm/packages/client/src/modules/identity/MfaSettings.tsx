import { useEffect, useState } from 'react';
import api from '../../lib/api';

interface MfaEnrollment {
  id: string;
  method: 'passkey' | 'totp' | 'email-otp';
  assurance: 'high' | 'low';
  label: string | null;
  enrolledAt: string;
  lastUsedAt: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export default function MfaSettings() {
  const [enrollments, setEnrollments] = useState<MfaEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Enrolment setup modal state
  const [enrolling, setEnrolling] = useState(false);
  const [setupDetails, setSetupDetails] = useState<{
    secret: string;
    uri: string;
    recoveryCodes: string[];
  } | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [confirming, setConfirming] = useState(false);

  const loadEnrollments = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get<ApiResponse<{ enrollments: MfaEnrollment[] }>>('/auth/mfa/status');
      setEnrollments(res.data.data.enrollments || []);
    } catch {
      setError('Unable to load MFA status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEnrollments();
  }, []);

  const handleStartEnrollment = async () => {
    try {
      setError('');
      setSuccess('');
      setEnrolling(true);
      const res = await api.post<ApiResponse<{
        secret: string;
        uri: string;
        recoveryCodes: string[];
      }>>('/auth/mfa/enroll');
      setSetupDetails(res.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to start MFA setup.');
      setEnrolling(false);
    }
  };

  const handleConfirmEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupDetails || !verificationCode.trim()) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }
    try {
      setConfirming(true);
      setError('');
      await api.post('/auth/mfa/confirm', {
        secret: setupDetails.secret,
        code: verificationCode.trim(),
        recoveryCodes: setupDetails.recoveryCodes,
        label: 'Authenticator App',
      });
      setSuccess('MFA successfully enabled! Make sure you save your recovery codes safely.');
      setEnrolling(false);
      setSetupDetails(null);
      setVerificationCode('');
      await loadEnrollments();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Invalid code. Please try again.');
    } finally {
      setConfirming(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Are you sure you want to remove this second factor?')) return;
    try {
      setError('');
      await api.delete(`/auth/mfa/enrollment/${id}`);
      setSuccess('MFA enrollment removed.');
      await loadEnrollments();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to remove enrollment.');
    }
  };

  return (
    <div className="module-tab-content">
      <div className="tab-header">
        <div>
          <h3>Multi-Factor Authentication (MFA)</h3>
          <p>Protect your account with high-assurance authentication factors (PRD §8.1, ID-4..ID-5d).</p>
        </div>
        {!enrolling && (
          <button className="btn-primary" onClick={handleStartEnrollment}>
            + Set Up Authenticator (TOTP)
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* SETUP TOTP MODAL / CARD */}
      {enrolling && setupDetails && (
        <div className="card form-card" style={{ marginBottom: '24px', borderColor: 'var(--primary, #6366f1)' }}>
          <h4>Set Up Two-Factor Authenticator</h4>
          <p style={{ color: 'var(--text-secondary, #64748b)', fontSize: '14px', marginBottom: '16px' }}>
            1. Open Google Authenticator, Authy, or your preferred authenticator app.<br />
            2. Enter the secret key below manually or use the URI:<br />
          </p>

          <div style={{ background: 'var(--bg-secondary, #f8fafc)', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px' }}>
            <strong>Secret Key: </strong>
            <code style={{ fontSize: '16px', letterSpacing: '2px', color: '#0284c7' }}>{setupDetails.secret}</code>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <strong>Single-Use Recovery Codes (Save these now!):</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginTop: '8px' }}>
              {setupDetails.recoveryCodes.map((c) => (
                <code key={c} style={{ background: '#f1f5f9', padding: '6px 8px', borderRadius: '4px', textAlign: 'center' }}>
                  {c}
                </code>
              ))}
            </div>
          </div>

          <form onSubmit={handleConfirmEnrollment}>
            <div className="form-group" style={{ maxWidth: '300px' }}>
              <label>Enter 6-Digit Code from App</label>
              <input
                type="text"
                placeholder="123456"
                maxLength={6}
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                autoFocus
                disabled={confirming}
              />
            </div>
            <div className="form-actions" style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
              <button type="submit" className="btn-primary" disabled={confirming}>
                {confirming ? 'Verifying...' : 'Verify & Enable MFA'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEnrolling(false);
                  setSetupDetails(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="loading-state">Loading MFA status...</div>
      ) : enrollments.length === 0 ? (
        <div className="empty-state card">
          <p>No second factors enrolled. High-assurance authentication is strongly recommended.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Factor Method</th>
                <th>Assurance Level</th>
                <th>Label</th>
                <th>Enrolled At</th>
                <th>Last Used</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map((enr) => (
                <tr key={enr.id}>
                  <td><strong>{enr.method.toUpperCase()}</strong></td>
                  <td>
                    <span className={`badge badge-${enr.assurance === 'high' ? 'primary' : 'secondary'}`}>
                      {enr.assurance} assurance
                    </span>
                  </td>
                  <td>{enr.label || 'Default'}</td>
                  <td>{new Date(enr.enrolledAt).toLocaleString()}</td>
                  <td>{enr.lastUsedAt ? new Date(enr.lastUsedAt).toLocaleString() : 'Never'}</td>
                  <td>
                    <button className="btn-sm btn-danger" onClick={() => handleRevoke(enr.id)}>
                      Remove
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
