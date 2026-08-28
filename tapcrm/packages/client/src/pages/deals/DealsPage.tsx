import React from 'react';
import { DealsIcon, PlusIcon } from '../../components/common/Icons';

export default function DealsPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-title">
          <h1>Deals & Opportunities Pipeline</h1>
          <p>Sales opportunities, deal stages, and approval workflows (PRD §8.4).</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-primary">
            <PlusIcon size={16} />
            <span>Create Deal</span>
          </button>
        </div>
      </div>

      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">
            <DealsIcon size={28} />
          </div>
          <h3>Deals Pipeline Empty</h3>
          <p>Create opportunities, assign sales agents, and track contract approval limits.</p>
        </div>
      </div>
    </div>
  );
}
