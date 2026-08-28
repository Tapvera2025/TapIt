import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import {
  UsersIcon,
  SearchIcon,
  RefreshIcon,
  AlertCircleIcon,
  DepartmentIcon,
  ShieldIcon,
} from '../../components/common/Icons';

interface Employee {
  id: string;
  fullName: string;
  email: string;
  positionId: string | null;
  positionCode: string | null;
  positionName: string | null;
  departmentId: string | null;
  departmentCode: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
  designationId: string | null;
  designationName: string | null;
  reportsTo: string | null;
  managerName: string | null;
  missingManager: boolean;
}

export default function UsersDirectoryPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDept, setFilterDept] = useState('all');

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get<{ success: boolean; data: Employee[] }>('/org/chart');
      setEmployees(res.data.data || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to load user directory.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const departments = [...new Set(employees.map((e) => e.departmentName).filter(Boolean))] as string[];

  const filtered = employees.filter((emp) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      emp.fullName.toLowerCase().includes(term) ||
      (emp.email && emp.email.toLowerCase().includes(term)) ||
      (emp.positionName && emp.positionName.toLowerCase().includes(term)) ||
      (emp.teamName && emp.teamName.toLowerCase().includes(term));
    const matchesDept = filterDept === 'all' || emp.departmentName === filterDept;
    return matchesSearch && matchesDept;
  });

  return (
    <div className="page-container">
      {/* HEADER */}
      <div className="page-header">
        <div className="page-header-title">
          <h1>Users & Employee Directory</h1>
          <p>
            Complete roster of staff members, position assignments, and reporting managers across Tapvera.
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-secondary" onClick={loadData} disabled={loading}>
            <RefreshIcon size={16} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircleIcon className="alert-icon" />
          <div>
            <strong>Error</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* FILTER BAR */}
      <div className="card" style={{ marginBottom: '24px', padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <SearchIcon size={16} />
            </span>
            <input
              type="text"
              className="form-control"
              style={{ paddingLeft: '36px' }}
              placeholder="Search by name, email, position title, or team..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Department:</label>
            <select
              className="form-control"
              style={{ width: '190px' }}
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* USERS LIST */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading staff directory...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <UsersIcon size={28} />
            </div>
            <h3>No employees found</h3>
            <p>No staff records match your search criteria.</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '18px' }}>
          {filtered.map((emp) => (
            <div key={emp.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: 'var(--radius-full)',
                      background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)',
                      color: '#ffffff',
                      fontWeight: 750,
                      fontSize: '15px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {emp.fullName
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((n) => n[0]?.toUpperCase())
                      .join('')}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--text-primary)' }}>{emp.fullName}</h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{emp.email}</p>
                  </div>
                </div>
                <span className="badge badge-active">Active</span>
              </div>

              <div style={{ padding: '12px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12.5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Department:</span>
                  <strong>{emp.departmentName || '—'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Position:</span>
                  <strong>{emp.positionName || '—'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Team:</span>
                  <span>{emp.teamName || 'General'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Reports To:</span>
                  <span>{emp.managerName || (emp.missingManager ? '⚠️ Missing' : 'Super Admin')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
