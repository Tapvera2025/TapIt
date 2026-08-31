import { useState } from 'react';
import api from '../../lib/api';

export default function SecuritySettings() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // Unlock user state
  const [unlockUserId, setUnlockUserId] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [unlockSuccess, setUnlockSuccess] = useState('');

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword) {
      setPasswordError('Current password is required.');
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError('New password must be at least 12 characters (ID-3 policy).');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    try {
      setChangingPassword('changing');
      await api.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      setPasswordSuccess('Password changed successfully. All other sessions have been invalidated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err?.response?.data?.message || 'Failed to change password.');
    } finally {
      setChangingPassword('');
    }
  };

  const handleUnlockUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError('');
    setUnlockSuccess('');

    if (!unlockUserId.trim()) {
      setUnlockError('User ID is required.');
      return;
    }

    try {
      setUnlocking(true);
      await api.post(`/identity/users/${unlockUserId.trim()}/unlock`);
      setUnlockSuccess(`User ${unlockUserId.trim()} unlocked successfully.`);
      setUnlockUserId('');
    } catch (err: any) {
      setUnlockError(err?.response?.data?.message || 'Failed to unlock user.');
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="module-tab-content">
      <div className="tab-header">
        <div>
          <h3>Account Security & Access Control</h3>
          <p>Password lifecycle, lockout management, and brute-force protection (PRD §8.1, ID-3, ID-7, ID-9).</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
        {/* PASSWORD CHANGE CARD */}
        <div className="card form-card">
          <h4>Change Account Password</h4>
          <p style={{ color: 'var(--text-secondary, #64748b)', fontSize: '13px', marginBottom: '16px' }}>
            Changing your password increments your session version and invalidates all existing sessions across devices.
          </p>

          {passwordError && <div className="alert alert-error">{passwordError}</div>}
          {passwordSuccess && <div className="alert alert-success">{passwordSuccess}</div>}

          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label>Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                disabled={Boolean(changingPassword)}
              />
            </div>
            <div className="form-group">
              <label>New Password (min 12 characters)</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 12 characters"
                disabled={Boolean(changingPassword)}
              />
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                disabled={Boolean(changingPassword)}
              />
            </div>
            <div className="form-actions" style={{ marginTop: '16px' }}>
              <button type="submit" className="btn-primary" disabled={Boolean(changingPassword)}>
                {changingPassword ? 'Updating Password...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>

        {/* UNLOCK ACCOUNT CARD */}
        <div className="card form-card">
          <h4>Unlock Locked Account</h4>
          <p style={{ color: 'var(--text-secondary, #64748b)', fontSize: '13px', marginBottom: '16px' }}>
            Administrative tool to release account lockouts triggered by progressive delay or brute-force attempts (ID-9).
          </p>

          {unlockError && <div className="alert alert-error">{unlockError}</div>}
          {unlockSuccess && <div className="alert alert-success">{unlockSuccess}</div>}

          <form onSubmit={handleUnlockUser}>
            <div className="form-group">
              <label>User UUID</label>
              <input
                type="text"
                value={unlockUserId}
                onChange={(e) => setUnlockUserId(e.target.value)}
                placeholder="e.g. 01a041f0-d07f-7856-aafb-7120dfcf055c"
                disabled={unlocking}
              />
            </div>
            <div className="form-actions" style={{ marginTop: '16px' }}>
              <button type="submit" className="btn-secondary" disabled={unlocking}>
                {unlocking ? 'Unlocking...' : 'Unlock Account'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
