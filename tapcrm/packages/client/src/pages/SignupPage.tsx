import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import './LoginPage.css';

interface SignupResponse {
  success: boolean;
  data?: { user?: { fullName: string; email: string }; verificationRequired?: boolean };
  message?: string;
}

function passwordChecks(password: string) {
  return {
    length: password.length >= 12,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

export default function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [fullName, setFullName] = useState('');
  const [contact, setContact] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const checks = useMemo(() => passwordChecks(password), [password]);
  const validPassword = Object.values(checks).every(Boolean);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!token)
      return setError(
        'This employee invitation is missing or invalid. Please use the invitation email link.',
      );
    if (!fullName.trim()) return setError('Full name is required.');
    if (!contact.trim()) return setError('Contact number is required.');
    if (!validPassword)
      return setError('Password does not meet all security requirements.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    try {
      setLoading(true);
      await api.post<SignupResponse>('/auth/signup', {
        invitationToken: token,
        fullName: fullName.trim(),
        contact: contact.trim(),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(gender ? { gender } : {}),
        password,
        confirmPassword,
      });
      setSuccess(
        'Account setup completed. Your email was verified. Redirecting to login...',
      );
      window.setTimeout(() => navigate('/login', { replace: true }), 900);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(
        e.response?.data?.message ??
          'Unable to complete account setup. The invitation may be expired or already used.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card-container">
        <div className="login-brand-header">
          <div className="login-brand-logo">T</div>
          <div>
            <h1 className="login-brand-title">TapCRM</h1>
            <span className="login-brand-subtitle">Employee Account Setup</span>
          </div>
        </div>
        <div className="login-box">
          <div className="login-box-header">
            <h2>Complete your account</h2>
            <p>
              Your organization has already assigned your employee ID, department,
              position and access.
            </p>
          </div>
          {error && (
            <div
              className="alert alert-error"
              style={{ padding: '10px 14px', marginBottom: 16 }}
            >
              {error}
            </div>
          )}
          {success && (
            <div
              className="alert alert-success"
              style={{ padding: '10px 14px', marginBottom: 16 }}
            >
              {success}
            </div>
          )}
          <form onSubmit={submit}>
            <div className="form-group">
              <label>Full Name</label>
              <input
                className="form-control"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={loading}
                autoComplete="name"
              />
            </div>
            <div className="form-group">
              <label>Contact Number</label>
              <input
                className="form-control"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                disabled={loading}
                autoComplete="tel"
                placeholder="+91 9876543210"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>
                  Date of Birth{' '}
                  <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                </label>
                <input
                  type="date"
                  className="form-control"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label>
                  Gender <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                </label>
                <select
                  className="form-control"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  disabled={loading}
                >
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="non-binary">Non-binary</option>
                  <option value="prefer-not-to-say">Prefer not to say</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-control"
                  style={{ paddingRight: 42 }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                lineHeight: 1.7,
                marginBottom: 14,
              }}
            >
              <div>{checks.length ? '✓' : '○'} 12+ characters</div>
              <div>{checks.upper ? '✓' : '○'} Uppercase letter</div>
              <div>{checks.lower ? '✓' : '○'} Lowercase letter</div>
              <div>{checks.number ? '✓' : '○'} Number</div>
              <div>{checks.special ? '✓' : '○'} Special character</div>
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input
                type="password"
                className="form-control"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: 12 }}
              disabled={loading || !token}
            >
              {loading ? 'Creating account...' : 'Complete account setup →'}
            </button>
          </form>
          <div className="login-box-footer">
            <span>
              Invitation-based onboarding • Position and access are controlled by your
              organization
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ width: '100%' }}
            onClick={() => navigate('/login')}
          >
            ← Back to Login
          </button>
        </div>
      </div>
    </div>
  );
}
