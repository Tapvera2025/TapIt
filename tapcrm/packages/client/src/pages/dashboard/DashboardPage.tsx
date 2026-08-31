import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UsersIcon,
  DealsIcon,
  TasksIcon,
  TeamsIcon,
  DepartmentIcon,
  PositionLadderIcon,
  ShieldIcon,
  CheckIcon,
  ChevronRightIcon,
  PlusIcon,
} from '../../components/common/Icons';
import type { User } from '../../components/layout/AppLayout';

interface DashboardPageProps {
  user: User;
}

export default function DashboardPage({ user }: DashboardPageProps) {
  const navigate = useNavigate();

  const firstName = user.fullName.split(' ')[0] || user.fullName;

  return (
    <div className="page-container">
      {/* WELCOME BANNER */}
      <div
        className="card"
        style={{
          marginBottom: '26px',
          background: 'linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-surface-hover) 100%)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <span className="badge badge-primary" style={{ marginBottom: '8px' }}>
            <span className="badge-dot" /> Operational Workspace
          </span>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>
            Welcome back, {firstName}
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Tapvera Technologies • Logged in as <strong>{user.accountType.replace('-', ' ')}</strong>
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 18px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              System Date
            </div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {new Date().toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </div>
          </div>
        </div>
      </div>

      {/* KPI METRICS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px', marginBottom: '26px' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Departments</span>
            <div style={{ padding: '8px', borderRadius: 'var(--radius-sm)', background: 'var(--primary-subtle)', color: 'var(--primary)' }}>
              <DepartmentIcon size={18} />
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)' }}>5</div>
          <span style={{ fontSize: '12px', color: 'var(--success-text)' }}>4 Active • 1 Inactive</span>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Positions Ladder</span>
            <div style={{ padding: '8px', borderRadius: 'var(--radius-sm)', background: 'var(--info-subtle)', color: 'var(--info)' }}>
              <PositionLadderIcon size={18} />
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)' }}>16</div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Seeded hierarchy levels</span>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Active Teams</span>
            <div style={{ padding: '8px', borderRadius: 'var(--radius-sm)', background: 'var(--warning-subtle)', color: 'var(--warning)' }}>
              <TeamsIcon size={18} />
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)' }}>3</div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Development sub-teams</span>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Session Security</span>
            <div style={{ padding: '8px', borderRadius: 'var(--radius-sm)', background: 'var(--success-subtle)', color: 'var(--success)' }}>
              <ShieldIcon size={18} />
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)' }}>Protected</div>
          <span style={{ fontSize: '12px', color: 'var(--success-text)' }}>Argon2id & HTTP-Only</span>
        </div>
      </div>

      {/* TWO COLUMN GRID: QUICK SHORTCUTS & ACCOUNT OVERVIEW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '22px', marginBottom: '26px' }}>
        {/* QUICK SHORTCUTS */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Quick Actions</h2>
              <p className="card-subtitle">Fast navigation to core system management tools</p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between', padding: '12px 16px' }}
              onClick={() => navigate('/org/departments')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <DepartmentIcon size={18} />
                <span>Manage Departments</span>
              </div>
              <ChevronRightIcon size={16} />
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between', padding: '12px 16px' }}
              onClick={() => navigate('/org/teams')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <TeamsIcon size={18} />
                <span>Manage Teams & Members</span>
              </div>
              <ChevronRightIcon size={16} />
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between', padding: '12px 16px' }}
              onClick={() => navigate('/org/positions')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <PositionLadderIcon size={18} />
                <span>Configure Authority Ladders</span>
              </div>
              <ChevronRightIcon size={16} />
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between', padding: '12px 16px' }}
              onClick={() => navigate('/security')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <ShieldIcon size={18} />
                <span>Identity & MFA Security</span>
              </div>
              <ChevronRightIcon size={16} />
            </button>
          </div>
        </div>

        {/* ACCOUNT STATUS & VERIFICATION */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Account & Access Profile</h2>
              <p className="card-subtitle">Active authentication context</p>
            </div>
            <span className="badge badge-active">
              <span className="badge-dot" /> Verified
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: 'var(--radius-full)',
                background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)',
                color: '#fff',
                fontSize: '18px',
                fontWeight: 750,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {user.fullName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{user.fullName}</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{user.email}</p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Account Type</span>
              <strong style={{ color: 'var(--text-primary)' }}>{user.accountType.replace('-', ' ')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Organization ID</span>
              <code style={{ fontSize: '12px' }}>{user.organizationId}</code>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Access Tier</span>
              <span className="badge badge-primary">Full Administrative Control</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
