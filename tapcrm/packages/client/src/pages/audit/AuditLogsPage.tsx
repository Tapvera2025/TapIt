import React from 'react';
import { AuditIcon, RefreshIcon } from '../../components/common/Icons';

export default function AuditLogsPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-title">
          <h1>System Audit Logs & Events</h1>
          <p>Immutable append-only audit stream of access modifications and system events (TECH.md §11).</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-secondary">
            <RefreshIcon size={16} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">
            <AuditIcon size={28} />
          </div>
          <h3>Audit Engine Active</h3>
          <p>Domain and Access events are captured in PostgreSQL audit outbox tables.</p>
        </div>
      </div>
    </div>
  );
}
