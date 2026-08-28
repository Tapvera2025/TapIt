import { useState } from 'react';
import MfaSettings from '../modules/identity/MfaSettings';
import SessionsManager from '../modules/identity/SessionsManager';
import GeofenceManager from '../modules/identity/GeofenceManager';
import SecuritySettings from '../modules/identity/SecuritySettings';

type IdentityTab = 'sessions' | 'mfa' | 'geofence' | 'security';

export default function IdentitySettings({ initialTab }: { initialTab?: IdentityTab }) {
  const [activeTab, setActiveTab] = useState<IdentityTab>(initialTab || 'sessions');

  return (
    <div className="organizations-container">
      <div className="organizations-header-card">
        <div className="organizations-title">
          <h2>Identity, Authentication & Security</h2>
          <p>Multi-factor authentication, active sessions across devices, geofenced logins, and access control (PRD §8.1).</p>
        </div>

        <div className="org-tabs-nav">
          <button
            type="button"
            className={`org-tab-btn ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            💻 Active Sessions
          </button>
          <button
            type="button"
            className={`org-tab-btn ${activeTab === 'mfa' ? 'active' : ''}`}
            onClick={() => setActiveTab('mfa')}
          >
            🔐 Multi-Factor (MFA)
          </button>
          <button
            type="button"
            className={`org-tab-btn ${activeTab === 'geofence' ? 'active' : ''}`}
            onClick={() => setActiveTab('geofence')}
          >
            📍 Geofenced Logins
          </button>
          <button
            type="button"
            className={`org-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            🛡️ Password & Security
          </button>
        </div>
      </div>

      <div className="org-tab-body">
        {activeTab === 'sessions' && <SessionsManager />}
        {activeTab === 'mfa' && <MfaSettings />}
        {activeTab === 'geofence' && <GeofenceManager />}
        {activeTab === 'security' && <SecuritySettings />}
      </div>
    </div>
  );
}
