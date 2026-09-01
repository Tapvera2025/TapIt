import { useEffect, useState, type FormEvent } from 'react';
import api from '../../lib/api';
import {
  UsersIcon,
  SearchIcon,
  RefreshIcon,
  AlertCircleIcon,
} from '../../components/common/Icons';

interface Employee {
  id: string;
  employeeId: string;
  fullName: string;
  email: string;
  contact?: string | null;
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
  employmentStatus: string;
  accountSetupComplete: boolean;
}
interface Department {
  id: string;
  code: string;
  name: string;
}
interface Team {
  id: string;
  department_id: string;
  name: string;
}
interface Designation {
  id: string;
  name: string;
}
interface Position {
  id: string;
  code: string;
  name: string;
}

const emptyForm = {
  employeeId: '',
  fullName: '',
  email: '',
  contact: '',
  dateOfBirth: '',
  gender: '',
  employmentType: 'full-time',
  joiningDate: new Date().toISOString().slice(0, 10),
  departmentId: '',
  positionId: '',
  teamId: '',
  designationId: '',
  specialization: '',
  reportsTo: '',
};

export default function UsersDirectoryPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [u, d, t, g] = await Promise.all([
        api.get('/users'),
        api.get('/org/departments'),
        api.get('/org/teams'),
        api.get('/org/designations'),
      ]);
      setEmployees(u.data.data ?? []);
      setDepartments(d.data.data ?? []);
      setTeams(t.data.data ?? []);
      setDesignations(g.data.data ?? []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Failed to load employee directory.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!form.departmentId) {
      setPositions([]);
      return;
    }
    const d = departments.find((x) => x.id === form.departmentId);
    if (!d) return;
    void api
      .get(`/org/ladder/${encodeURIComponent(d.code)}`)
      .then((r) => setPositions(r.data.data ?? []))
      .catch(() => setPositions([]));
  }, [form.departmentId, departments]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const r = await api.post('/users', {
        ...form,
        contact: form.contact || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        gender: form.gender || undefined,
        teamId: form.teamId || null,
        designationId: form.designationId || null,
        specialization: form.specialization || null,
        reportsTo: form.reportsTo || null,
      });
      setSuccess(
        `Employee ${r.data.data?.employeeId ?? form.employeeId} created. Invitation email sent.`,
      );
      setShowAdd(false);
      setForm({ ...emptyForm });
      await load();
    } catch (err: unknown) {
      const x = err as { response?: { data?: { message?: string } } };
      setError(x.response?.data?.message ?? 'Unable to create employee.');
    } finally {
      setSaving(false);
    }
  };
  const filtered = employees.filter((x) => {
    const q = search.toLowerCase();
    return (
      (!q ||
        x.fullName.toLowerCase().includes(q) ||
        x.email.toLowerCase().includes(q) ||
        x.employeeId.toLowerCase().includes(q) ||
        String(x.positionName ?? '')
          .toLowerCase()
          .includes(q)) &&
      (dept === 'all' || x.departmentId === dept)
    );
  });
  const field = (
    key: keyof typeof form,
    label: string,
    type = 'text',
    required = false,
  ) => (
    <div className="form-group">
      <label>
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        type={type}
        className="form-control"
        value={form[key]}
        onChange={(e) => setForm((v) => ({ ...v, [key]: e.target.value }))}
        required={required}
        disabled={saving}
      />
    </div>
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-title">
          <h1>Users & Employee Directory</h1>
          <p>
            Manage employee identity, employment assignment and secure account onboarding.
          </p>
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshIcon size={16} /> Refresh
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setError('');
              setSuccess('');
              setShowAdd(true);
            }}
          >
            + Add Employee
          </button>
        </div>
      </div>
      {error && (
        <div className="alert alert-error">
          <AlertCircleIcon className="alert-icon" />
          <div>{error}</div>
        </div>
      )}
      {success && <div className="alert alert-success">{success}</div>}
      <div className="card" style={{ marginBottom: 24, padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
            <span
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            >
              <SearchIcon size={16} />
            </span>
            <input
              className="form-control"
              style={{ paddingLeft: 36 }}
              placeholder="Search employee ID, name, email or position..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="form-control"
            style={{ width: 220 }}
            value={dept}
            onChange={(e) => setDept(e.target.value)}
          >
            <option value="all">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading employee directory...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <UsersIcon size={28} />
            </div>
            <h3>No employees found</h3>
            <p>Create the first employee or change your filters.</p>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))',
            gap: 18,
          }}
        >
          {filtered.map((x) => (
            <div className="card" key={x.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>{x.fullName}</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {x.employeeId} • {x.email}
                  </p>
                </div>
                <span className="badge">{x.employmentStatus}</span>
              </div>
              <div
                style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)' }}
              >
                <div>
                  <strong>Department:</strong> {x.departmentName ?? '—'}
                </div>
                <div>
                  <strong>Position:</strong> {x.positionName ?? '—'}
                </div>
                <div>
                  <strong>Team:</strong> {x.teamName ?? '—'}
                </div>
                <div>
                  <strong>Manager:</strong> {x.managerName ?? '—'}
                </div>
                <div>
                  <strong>Account:</strong>{' '}
                  {x.accountSetupComplete ? 'Setup complete' : 'Invitation pending'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showAdd && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            style={{ width: 'min(900px,100%)', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <div>
                <h2>Add Employee</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  Admin assigns employment and access. The employee sets their password
                  through the invitation.
                </p>
              </div>
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={(event) => { void submit(event); }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {field('employeeId', 'Employee ID', 'text', true)}
                {field('fullName', 'Full Name', 'text', true)}
                {field('email', 'Work Email', 'email', true)}
                {field('contact', 'Contact Number')}
                {field('dateOfBirth', 'Date of Birth', 'date')}
                {
                  <div className="form-group">
                    <label>Gender</label>
                    <select
                      className="form-control"
                      value={form.gender}
                      onChange={(e) => setForm((v) => ({ ...v, gender: e.target.value }))}
                    >
                      <option value="">Prefer not to say</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="non-binary">Non-binary</option>
                      <option value="prefer-not-to-say">Prefer not to say</option>
                    </select>
                  </div>
                }
                {
                  <div className="form-group">
                    <label>Department *</label>
                    <select
                      className="form-control"
                      required
                      value={form.departmentId}
                      onChange={(e) =>
                        setForm((v) => ({
                          ...v,
                          departmentId: e.target.value,
                          positionId: '',
                          teamId: '',
                        }))
                      }
                    >
                      <option value="">Select department</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                }
                {
                  <div className="form-group">
                    <label>Position *</label>
                    <select
                      className="form-control"
                      required
                      value={form.positionId}
                      onChange={(e) =>
                        setForm((v) => ({ ...v, positionId: e.target.value }))
                      }
                    >
                      <option value="">Select position</option>
                      {positions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.code})
                        </option>
                      ))}
                    </select>
                  </div>
                }
                {
                  <div className="form-group">
                    <label>Team</label>
                    <select
                      className="form-control"
                      value={form.teamId}
                      onChange={(e) => setForm((v) => ({ ...v, teamId: e.target.value }))}
                    >
                      <option value="">No team</option>
                      {teams
                        .filter((t) => t.department_id === form.departmentId)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </div>
                }
                {
                  <div className="form-group">
                    <label>Designation</label>
                    <select
                      className="form-control"
                      value={form.designationId}
                      onChange={(e) =>
                        setForm((v) => ({ ...v, designationId: e.target.value }))
                      }
                    >
                      <option value="">No designation</option>
                      {designations.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                }
                {
                  <div className="form-group">
                    <label>Employment Type *</label>
                    <select
                      className="form-control"
                      value={form.employmentType}
                      onChange={(e) =>
                        setForm((v) => ({ ...v, employmentType: e.target.value }))
                      }
                    >
                      <option value="full-time">Full-time</option>
                      <option value="part-time">Part-time</option>
                      <option value="contract">Contract</option>
                      <option value="intern">Intern</option>
                      <option value="temporary">Temporary</option>
                    </select>
                  </div>
                }
                {field('joiningDate', 'Joining Date', 'date', true)}
                {field('specialization', 'Specialization')}
                {
                  <div className="form-group">
                    <label>Reporting Manager</label>
                    <select
                      className="form-control"
                      value={form.reportsTo}
                      onChange={(e) =>
                        setForm((v) => ({ ...v, reportsTo: e.target.value }))
                      }
                    >
                      <option value="">No manager</option>
                      {employees
                        .filter((x) => x.employmentStatus === 'active')
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.fullName} — {x.positionName ?? ''}
                          </option>
                        ))}
                    </select>
                  </div>
                }
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  marginTop: 20,
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAdd(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={saving}>
                  {saving ? 'Creating...' : 'Create & Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
