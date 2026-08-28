import React, { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import {
  ShieldIcon,
  CheckIcon,
  AlertCircleIcon,
  EyeIcon,
  EyeOffIcon,
  SunIcon,
  MoonIcon,
} from '../components/common/Icons';
import './LoginPage.css';

type AccountType = 'super-admin' | 'employee' | 'client';

interface LoginResponse {
  success: boolean;
  data: {
    mfaRequired?: boolean;
    mfaToken?: string;
    requiresHighAssurance?: boolean;
    availableMethods?: string[];
    user?: {
      id: string;
      organizationId: string;
      accountType: string;
      email: string;
      fullName: string;
    };
  };
  message?: string;
}

export default function LoginPage({ onLoginSuccess }: { onLoginSuccess?: () => void }) {
  const navigate = useNavigate();

  const [accountType, setAccountType] = useState<AccountType>('super-admin');
  const [email, setEmail] = useState('admin@tapvera.io');
  const [password, setPassword] = useState('Admin@Tapvera2026!');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // MFA Challenge State
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  // Notifications
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Theme
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('tapcrm-theme') === 'dark';
  });

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem('tapcrm-theme', next ? 'dark' : 'light');
  };

  const handleLoginSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!email.trim()) {
      setErrorMessage('Email address is required.');
      return;
    }
    if (!password) {
      setErrorMessage('Password is required.');
      return;
    }

    try {
      setLoading(true);
      const response = await api.post<LoginResponse>('/auth/login', {
        organizationCode: 'tapvera',
        accountType,
        email: email.trim(),
        password,
      });

      const resData = response.data?.data;
      if (resData?.mfaRequired && resData?.mfaToken) {
        setMfaToken(resData.mfaToken);
        setMfaStep(true);
        setSuccessMessage('Please enter your 2FA verification code to complete login.');
        return;
      }

      setSuccessMessage('Authentication successful! Redirecting...');
      if (onLoginSuccess) {
        onLoginSuccess();
      }
      setTimeout(() => {
        void navigate('/dashboard', { replace: true });
      }, 300);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string } } };
      setErrorMessage(
        e.response?.data?.message ||
          e.response?.data?.error ||
          'Unable to sign in. Please verify your email and password.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!mfaCode.trim()) {
      setErrorMessage('Please enter your verification code.');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage('');
      await api.post('/auth/mfa/challenge', {
        mfaToken,
        method: mfaCode.includes('-') ? 'recovery-code' : 'totp',
        factorValue: mfaCode.trim(),
      });

      setSuccessMessage('Verification confirmed. Redirecting...');
      if (onLoginSuccess) {
        onLoginSuccess();
      }
      setTimeout(() => {
        void navigate('/dashboard', { replace: true });
      }, 300);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e.response?.data?.message || 'Invalid or expired 2FA verification code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      {/* THEME TOGGLE BUTTON IN TOP CORNER */}
      <button
        type="button"
        className="login-theme-btn"
        onClick={toggleTheme}
        aria-label="Toggle Theme"
      >
        {darkMode ? <SunIcon size={18} /> : <MoonIcon size={18} />}
      </button>

      <div className="login-card-container">
        {/* BRAND HEADER */}
        <div className="login-brand-header">
          <div className="login-brand-logo">T</div>
          <div>
            <h1 className="login-brand-title">TapCRM</h1>
            <span className="login-brand-subtitle">Operating System for Services</span>
          </div>
        </div>

        {/* CARD CONTAINER */}
        <div className="login-box">
          <div className="login-box-header">
            <h2>{mfaStep ? 'Two-Factor Verification' : 'Sign in to TapCRM'}</h2>
            <p>
              {mfaStep
                ? 'Enter the 6-digit verification code from your authenticator app.'
                : 'Organization: TAPVERA • Select account role to authenticate.'}
            </p>
          </div>

          {/* NOTIFICATIONS */}
          {errorMessage && (
            <div className="alert alert-error" style={{ padding: '10px 14px', marginBottom: '16px' }}>
              <AlertCircleIcon className="alert-icon" size={16} />
              <div style={{ fontSize: '13px' }}>{errorMessage}</div>
            </div>
          )}

          {successMessage && (
            <div className="alert alert-success" style={{ padding: '10px 14px', marginBottom: '16px' }}>
              <CheckIcon className="alert-icon" size={16} />
              <div style={{ fontSize: '13px' }}>{successMessage}</div>
            </div>
          )}

          {mfaStep ? (
            /* MFA CHALLENGE */
            <form onSubmit={handleMfaSubmit}>
              <div className="form-group" style={{ marginBottom: '18px' }}>
                <label>Authenticator or Recovery Code</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. 123456 or XXXXX-XXXXX"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  autoFocus
                  disabled={loading}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
                  {loading ? 'Verifying code...' : 'Confirm & Sign in →'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setMfaStep(false);
                    setMfaCode('');
                    setErrorMessage('');
                    setSuccessMessage('');
                  }}
                >
                  ← Back to Login
                </button>
              </div>
            </form>
          ) : (
            /* REGULAR LOGIN FORM */
            <form onSubmit={handleLoginSubmit}>
              {/* ACCOUNT TYPE */}
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Account Role</label>
                <select
                  className="form-control"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                  disabled={loading}
                >
                  <option value="super-admin">Super Admin (Root Tenant Administrator)</option>
                  <option value="employee">Employee (Staff Member)</option>
                  <option value="client">Client (External Client Account)</option>
                </select>
              </div>

              {/* EMAIL */}
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Email Address</label>
                <input
                  type="email"
                  className="form-control"
                  placeholder="admin@tapvera.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              {/* PASSWORD */}
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label>Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="form-control"
                    style={{ paddingRight: '42px' }}
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                  </button>
                </div>
              </div>

              {/* SUBMIT BUTTON */}
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', padding: '12px', fontSize: '14.5px' }}
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign in to Workspace →'}
              </button>
            </form>
          )}

          {/* FOOTER BADGE */}
          <div className="login-box-footer">
            <ShieldIcon size={15} />
            <span>Protected by Argon2id & HTTP-Only Secure Cookies</span>
          </div>
        </div>
      </div>
    </div>
  );
}
