import React from 'react';
import { CustomerIcon, PlusIcon } from '../../components/common/Icons';

export default function CustomersPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-title">
          <h1>Customers & Accounts</h1>
          <p>Client relationships, service accounts, and enterprise contacts (PRD §8.3).</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-primary">
            <PlusIcon size={16} />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">
            <CustomerIcon size={28} />
          </div>
          <h3>Customer Directory Ready</h3>
          <p>No customer accounts recorded yet. Ready to register new enterprise clients and manage contacts.</p>
        </div>
      </div>
    </div>
  );
}
