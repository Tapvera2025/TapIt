import React from 'react';
import {
  RolesIcon,
  CheckIcon,
} from '../../components/common/Icons';

export default function RolesPermissionsPage() {
  const seededRoles = [
    { title: 'Super Admin', type: 'Global Authority', description: 'Full root tenant management, policy delegation, and system control.' },
    { title: 'Sales Department Head', type: 'Level 90', description: 'Department-wide deals visibility, pipeline management, and discount approvals.' },
    { title: 'Sales Team Lead', type: 'Level 70', description: 'Sales team lateral visibility, rep assignments, and stage approvals.' },
    { title: 'Sales Supervisor', type: 'Level 50', description: 'Supervised pool oversight and task escalations.' },
    { title: 'Project Manager', type: 'Level 80', description: 'Direct client delivery oversight and operational review.' },
    { title: 'Dev Department Head', type: 'Level 90', description: 'Engineering, marketing, and content team ladder supervision.' },
    { title: 'HR Head / Executive', type: 'Level 90 / 40', description: 'Staffing roster, leave policies, and organizational structure changes.' },
    { title: 'Base Employee', type: 'Level 20 - 25', description: 'Own-scope task execution, deal participation, and profile access.' },
  ];

  return (
    <div className="page-container">
      {/* HEADER */}
      <div className="page-header">
        <div className="page-header-title">
          <h1>Roles & Authorization Matrix</h1>
          <p>
            Role-based operating system capabilities, position authority ladders, and lateral visibility scopes (PRD §6).
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '18px', marginBottom: '24px' }}>
        {seededRoles.map((role) => (
          <div key={role.title} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{ padding: '8px', borderRadius: 'var(--radius-sm)', background: 'var(--primary-subtle)', color: 'var(--primary)' }}>
                <RolesIcon size={18} />
              </div>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{role.title}</h3>
                <span className="badge badge-info" style={{ fontSize: '11px' }}>{role.type}</span>
              </div>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {role.description}
            </p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Authorization Architecture Guarantees</h2>
            <p className="card-subtitle">Enforced at the platform database and kernel layer (TECH.md §6)</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          <div style={{ padding: '14px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', marginBottom: '4px' }}>
              <CheckIcon size={16} /> Row-Level Security (RLS)
            </strong>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
              Every database query automatically filters rows by tenant organization ID and lateral scope.
            </p>
          </div>

          <div style={{ padding: '14px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', marginBottom: '4px' }}>
              <CheckIcon size={16} /> Immutable Audit Trail
            </strong>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
              All permission modifications emit structured change records to audit and domain outboxes.
            </p>
          </div>

          <div style={{ padding: '14px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', marginBottom: '4px' }}>
              <CheckIcon size={16} /> Matrix Expansion (MX-3)
            </strong>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
              863 position policy rows generated from the permission matrix and verified during CI.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
