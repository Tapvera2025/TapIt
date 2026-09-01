import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import {
  DepartmentIcon,
  TeamsIcon,
  PositionLadderIcon,
  UsersIcon,
  RefreshIcon,
  SearchIcon,
  AlertCircleIcon,
} from '../../components/common/Icons';

interface OrgEmployee {
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

interface Department {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: string;
}

export default function OrgOverviewPage() {
  const [employees, setEmployees] = useState<OrgEmployee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDept, setFilterDept] = useState('all');

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [chartRes, deptRes] = await Promise.all([
        api.get<{ success: boolean; data: OrgEmployee[] }>('/org/chart'),
        api.get<{ success: boolean; data: Department[] }>('/org/departments'),
      ]);
      setEmployees(chartRes.data.data || []);
      setDepartments(deptRes.data.data || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to load organization chart data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch =
      emp.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.email && emp.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (emp.positionName && emp.positionName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (emp.teamName && emp.teamName.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesDept = filterDept === 'all' || emp.departmentCode === filterDept;
    return matchesSearch && matchesDept;
  });

  return (
    <div className="page-container">
      {/* HEADER */}
      <div className="page-header">
        <div className="page-header-title">
          <h1>Organization Architecture & Chart</h1>
          <p>
            Visual reporting hierarchy, staffing roster, and authority structure across departments.
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-secondary" onClick={() => { void loadData(); }} disabled={loading}>
            <RefreshIcon size={16} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircleIcon className="alert-icon" />
          <div>
            <strong>Error loading organization chart</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* STATS OVERVIEW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '10px', borderRadius: 'var(--radius-md)', background: 'var(--primary-subtle)', color: 'var(--primary)' }}>
              <UsersIcon size={22} />
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>{employees.length}</div>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Active Staff Members</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '10px', borderRadius: 'var(--radius-md)', background: 'var(--success-subtle)', color: 'var(--success)' }}>
              <DepartmentIcon size={22} />
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>
                {departments.filter((d) => d.status === 'active').length} / {departments.length}
              </div>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Active Departments</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '10px', borderRadius: 'var(--radius-md)', background: 'var(--info-subtle)', color: 'var(--info)' }}>
              <PositionLadderIcon size={22} />
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>16</div>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Seeded & Authority Positions</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '10px', borderRadius: 'var(--radius-md)', background: 'var(--warning-subtle)', color: 'var(--warning)' }}>
              <TeamsIcon size={22} />
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>3</div>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Delivery & Sales Teams</div>
            </div>
          </div>
        </div>
      </div>

      {/* FILTER CONTROLS */}
      <div className="card" style={{ marginBottom: '24px', padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1', minWidth: '260px' }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                <SearchIcon size={16} />
              </span>
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: '36px' }}
                placeholder="Search staff by name, email, position, or team..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              Department:
            </label>
            <select
              className="form-control"
              style={{ width: '180px' }}
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ROSTER / CHART LIST */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading organization chart...</span>
        </div>
      ) : filteredEmployees.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <UsersIcon size={28} />
            </div>
            <h3>No employees found</h3>
            <p>
              {searchTerm || filterDept !== 'all'
                ? 'Try adjusting your search criteria or department filter.'
                : 'Your organization currently has no active employee records. Super-admin login is active.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee Name</th>
                <th>Department</th>
                <th>Position Title</th>
                <th>Team</th>
                <th>Designation</th>
                <th>Reports To</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: 'var(--radius-full)',
                          background: 'var(--primary-subtle)',
                          color: 'var(--primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '12px',
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
                        <strong>{emp.fullName}</strong>
                        {emp.email && (
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{emp.email}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-info">
                      {emp.departmentName || emp.departmentCode || '—'}
                    </span>
                  </td>
                  <td>
                    <strong>{emp.positionName || '—'}</strong>
                    {emp.positionCode && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{emp.positionCode}</div>
                    )}
                  </td>
                  <td>{emp.teamName || <span style={{ color: 'var(--text-muted)' }}>General</span>}</td>
                  <td>{emp.designationName || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>
                    {emp.managerName ? (
                      <span style={{ fontWeight: 500 }}>{emp.managerName}</span>
                    ) : emp.missingManager ? (
                      <span className="badge badge-warning" title="Missing assigned manager in ladder chain">
                        Missing Manager
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Direct (Super Admin)</span>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-active">
                      <span className="badge-dot" /> Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
