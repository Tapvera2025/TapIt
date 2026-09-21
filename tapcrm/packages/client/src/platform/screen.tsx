import { BrandLogo } from '../ui/BrandLogo.js';
import { useEffect, useState } from 'react';
import { api, clearTokens, saveTokens, updateOrganization } from './api.js';
import { ModuleToggleModal } from './ModuleToggleModal.js';
import { ThemeToggle } from '../theme/ThemeToggle.js';

interface Organization {
  id: string;
  code: string;
  name: string;
  timezone: string;
  currency: string;
  status: 'active' | 'suspended';
  legalCompanyName: string;
  companyType: string;
  industry: string;
  website: string;
  companyEmail: string;
  ownerFullName: string;
  ownerDesignation: string;
  ownerEmail: string;
  ownerMobile: string;
  ownerAlternateNumber: string;
  primaryPhone: string;
  alternatePhone: string;
  supportEmail: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  gstin: string;
  pan: string;
  registrationNumber: string;
}
interface Invitation {
  id: string;
  organizationId: string;
  companyName: string;
  companyCode: string;
  companyStatus: 'active' | 'suspended';
  adminName: string;
  adminEmail: string;
  status: 'ACCEPTED' | 'REVOKED' | 'EXPIRED' | 'PENDING';
  createdAt: string;
  expiresAt: string;
  lastSentAt: string;
  resendCount: number;
}
interface CreatedInvitation {
  id: string;
  email: string;
  expiresAt: string;
  invitationUrl?: string;
  delivery: string;
}
interface AdminPasswordReset {
  email: string;
  expiresAt: string;
  resetUrl?: string;
  delivery: string;
}
interface Entitlement {
  key: string;
  name: string;
  isCore: boolean;
  status: 'enabled' | 'disabled';
}

const PLATFORM_GROUPS = [
  { key: 'hr', label: 'HR', moduleKeys: ['employee-directory', 'onboarding', 'live-status', 'attendance', 'break-management', 'shifts', 'biometric', 'leave', 'holidays', 'payroll', 'performance'] },
  { key: 'sales', label: 'Sales', moduleKeys: ['territories', 'leads', 'callbacks', 'handovers', 'deals', 'approvals'] },
  { key: 'development', label: 'Development', moduleKeys: ['handoff', 'projects', 'tasks', 'resource-planning', 'delivery'] },
  { key: 'client', label: 'Client', moduleKeys: ['clients', 'post-closure', 'client-portal'] },
  { key: 'finance', label: 'Finance', moduleKeys: ['billing-terms', 'invoicing', 'payments', 'receivables', 'payables', 'accounting'] },
] as const;
const COUNTRY_CODES = ['+91', '+1', '+44', '+61', '+65', '+971'] as const;
const TEN_DIGIT_PHONE = /^\d{10}$/;
const COMPANY_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const POSTAL_CODE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,31}$/;
const FORM_INPUT_CLASS = 'mt-2 block w-full rounded-[9px] border border-app-border bg-app-background px-[13px] py-3 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20';

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function formatPhoneNumber(countryCode: string, phone: string) {
  return phone.trim() ? `${countryCode} ${phone.trim()}` : '';
}

const INITIAL_FORM = {
  name: '', code: '', legalCompanyName: '', companyType: 'Private', industry: 'IT / Software', website: '', companyEmail: '', adminEmail: '',
  ownerFullName: '', ownerDesignation: '', ownerMobile: '', ownerAlternateNumber: '', phoneCountryCode: '+91', primaryPhone: '', alternatePhone: '', supportEmail: '',
  addressLine1: '', addressLine2: '', city: '', state: '', country: '', postalCode: '', gstin: '', pan: '', registrationNumber: '', timezone: 'Asia/Kolkata', currency: 'INR',
};

function organizationProfilePayload(form: typeof INITIAL_FORM) {
  return {
    name: form.name,
    code: form.code,
    legalCompanyName: form.legalCompanyName,
    companyType: form.companyType,
    industry: form.industry,
    website: form.website,
    companyEmail: form.companyEmail,
    ownerFullName: form.ownerFullName,
    ownerDesignation: form.ownerDesignation,
    adminEmail: form.adminEmail,
    ownerMobile: formatPhoneNumber(form.phoneCountryCode, form.ownerMobile),
    ownerAlternateNumber: formatPhoneNumber(form.phoneCountryCode, form.ownerAlternateNumber),
    primaryPhone: formatPhoneNumber(form.phoneCountryCode, form.primaryPhone),
    alternatePhone: formatPhoneNumber(form.phoneCountryCode, form.alternatePhone),
    supportEmail: form.supportEmail,
    addressLine1: form.addressLine1,
    addressLine2: form.addressLine2,
    city: form.city,
    state: form.state,
    country: form.country,
    postalCode: form.postalCode,
    gstin: form.gstin,
    pan: form.pan,
    registrationNumber: form.registrationNumber,
    timezone: form.timezone,
    currency: form.currency,
  };
}

function splitPhoneNumber(value: string) {
  const match = value.trim().match(/^(\+[1-9]\d{0,2})\s+(\d{10})$/);
  return match
    ? { countryCode: match[1] ?? '+91', number: match[2] ?? '' }
    : { countryCode: '+91', number: '' };
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function TextField({
  label,
  value,
  onChange,
  required = false,
  type = 'text',
  placeholder,
  readOnly = false,
  maxLength,
  pattern,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
  readOnly?: boolean;
  maxLength?: number;
  pattern?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-semibold text-app-muted">{label}{required ? ' *' : ''}</span>
      <input
        className={FORM_INPUT_CLASS}
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        maxLength={maxLength}
        pattern={pattern}
        inputMode={inputMode}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-semibold text-app-muted">{label}{required ? ' *' : ''}</span>
      <select
        className={`${FORM_INPUT_CLASS} cursor-pointer`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function PhoneField({
  label,
  value,
  countryCode,
  onChange,
  onCountryCodeChange,
  required = false,
}: {
  label: string;
  value: string;
  countryCode: string;
  onChange: (value: string) => void;
  onCountryCodeChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-semibold text-app-muted">{label}{required ? ' *' : ''}</span>
      <div className="mt-2 grid grid-cols-[82px_minmax(0,1fr)] gap-2">
        <select
          className={`${FORM_INPUT_CLASS} mt-0 cursor-pointer`}
          value={countryCode}
          onChange={(event) => onCountryCodeChange(event.target.value)}
          aria-label={`${label} country code`}
        >
          {COUNTRY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
        <input
          className={`${FORM_INPUT_CLASS} mt-0`}
          type="tel"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 10))}
          required={required}
          inputMode="numeric"
          maxLength={10}
          pattern="[0-9]{10}"
          placeholder="10-digit number"
          title="Enter exactly 10 digits"
        />
      </div>
    </label>
  );
}

export function PlatformLogin({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ accessToken: string; refreshToken: string }>(
        '/platform/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email, password, deviceLabel: 'Platform Web' }),
        },
      );
      saveTokens(result.accessToken, result.refreshToken);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-app-background px-6 py-6 text-app-foreground">
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        className="w-full max-w-[430px] rounded-[18px] border border-app-border bg-app-surface p-10 shadow-2xl max-[560px]:px-[22px] max-[560px]:py-[30px]"
      >
        <div className="mb-6">
          <BrandLogo className="w-[200px]" />
        </div>
        <p className="mb-[7px] text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">Control panel</p>
        <h1 className="mt-6 text-4xl">Welcome back.</h1>
        <p className="mt-2 mb-6 text-sm leading-6 text-app-muted">Sign in to manage companies, access and platform modules.</p>
        <input
          className="mt-4 block w-full rounded-[9px] border border-app-border bg-app-background px-[13px] py-3 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
          placeholder="Master Admin email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <div className="relative">
          <input
          className="mt-4 block w-full rounded-[9px] border border-app-border bg-app-background px-[13px] py-3 pr-12 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
            placeholder="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 grid size-[34px] -translate-y-1/2 place-items-center rounded-[7px] border-0 bg-transparent p-0 text-app-muted transition hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-1"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            <svg className="size-[18px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              {showPassword ? (
                <>
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                  <path d="M9.9 4.3A10.8 10.8 0 0 1 12 4c5.2 0 8.7 4 10 8a13.7 13.7 0 0 1-3.1 5" />
                  <path d="M6.2 6.2C4.5 7.3 3.2 9.2 2 12c1.3 4 4.8 8 10 8a10.8 10.8 0 0 0 3.4-.5" />
                </>
              ) : (
                <>
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="2.5" />
                </>
              )}
            </svg>
          </button>
        </div>
        <button className="mt-[22px] w-full rounded-[9px] bg-app-accent px-4 py-[13px] font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110 disabled:cursor-wait disabled:opacity-60" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="mt-3 text-[13px] text-app-danger">{error}</p>}
      </form>
      <ThemeToggle floating />
    </main>
  );
}

export function PlatformDashboard({ onLogout }: { onLogout: () => void }) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [entitlements, setEntitlements] = useState<Record<string, Entitlement[]>>({});
  const [stats, setStats] = useState<Record<string, number>>({});
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [invitationSearch, setInvitationSearch] = useState('');
  const [invitationStatus, setInvitationStatus] = useState('');
  const [invitationPage, setInvitationPage] = useState(1);
  const [invitationTotal, setInvitationTotal] = useState(0);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);
  const [viewInvitationId, setViewInvitationId] = useState<string | null>(null);
  const [invitationPreview, setInvitationPreview] = useState<{
    id: string;
    invitationUrl: string;
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [formStep, setFormStep] = useState(0);
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingOrganizationId, setEditingOrganizationId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);
  const [pendingModuleAction, setPendingModuleAction] = useState<{
    org: Organization;
    group: (typeof PLATFORM_GROUPS)[number];
    currentlyEnabled: boolean;
  } | null>(null);
  const [moduleActionKey, setModuleActionKey] = useState<string | null>(null);
  const [pendingCompanyAction, setPendingCompanyAction] = useState<{
    type: 'delete' | 'status';
    org: Organization;
    nextStatus?: 'active' | 'suspended';
  } | null>(null);

  const loadInvitations = async (
    page = invitationPage,
    filters: { search?: string; status?: string } = {},
  ) => {
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    const search = filters.search ?? invitationSearch;
    const status = filters.status ?? invitationStatus;
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    const result = await api<{ items: Invitation[]; totalCount: number; page: number }>(
      `/platform/invitations?${params.toString()}`,
    );
    setInvitations(result.items);
    setInvitationTotal(result.totalCount);
    setInvitationPage(result.page);
  };

  const load = async () => {
    const [o, s] = await Promise.all([
      api<Organization[]>('/platform/organizations'),
      api<Record<string, number>>('/platform/dashboard/stats'),
    ]);
    setOrgs(o);
    setStats(s);
    const entries = await Promise.all(
      o.map(
        async (org) =>
          [
            org.id,
            await api<Entitlement[]>(`/platform/organizations/${org.id}/modules`),
          ] as const,
      ),
    );
    setEntitlements(Object.fromEntries(entries));
    await loadInvitations();
  };

  useEffect(() => {
    void load();
  }, []);

  async function resendInvitation(invitation: Invitation) {
    const confirmed = window.confirm(
      `Send a new invitation to ${invitation.adminEmail}? The current invitation will stop working.`,
    );
    if (!confirmed) return;
    setInvitationActionId(invitation.id);
    setMessage('');
    try {
      const result = await api<CreatedInvitation>(`/platform/organizations/${invitation.organizationId}/admin/resend`, {
        method: 'POST',
        body: JSON.stringify({ email: invitation.adminEmail }),
      });
      setInvitationPreview(result.invitationUrl ? { id: result.id, invitationUrl: result.invitationUrl } : null);
      setViewInvitationId(result.id);
      setMessage(`A new invitation was sent to ${invitation.adminEmail}.`);
      await loadInvitations();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Invitation resend failed');
    } finally {
      setInvitationActionId(null);
    }
  }

  async function sendAdminPasswordReset(invitation: Invitation) {
    const confirmed = window.confirm(
      `Send a password reset email to ${invitation.adminEmail}? Their current password stays valid until they follow the link and pick a new one.`,
    );
    if (!confirmed) return;
    setInvitationActionId(invitation.id);
    setMessage('');
    try {
      const result = await api<AdminPasswordReset>(
        `/platform/organizations/${invitation.organizationId}/admin/reset-password`,
        { method: 'POST' },
      );
      setInvitationPreview(
        result.resetUrl ? { id: invitation.id, invitationUrl: result.resetUrl } : null,
      );
      setViewInvitationId(invitation.id);
      setMessage(`A password reset link was sent to ${invitation.adminEmail}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setInvitationActionId(null);
    }
  }

  async function revokeInvitation(invitation: Invitation) {
    const confirmed = window.confirm(
      `Revoke the pending invitation for ${invitation.adminEmail}? Its link will stop working immediately.`,
    );
    if (!confirmed) return;
    setInvitationActionId(invitation.id);
    setMessage('');
    try {
      await api(`/platform/invitations/${invitation.id}/revoke`, { method: 'POST' });
      setMessage(`The invitation for ${invitation.adminEmail} was revoked.`);
      await loadInvitations();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Invitation revoke failed');
    } finally {
      setInvitationActionId(null);
    }
  }

  async function applyInvitationFilters() {
    setInvitationPage(1);
    await loadInvitations(1);
  }

  async function changeInvitationStatus(status: string) {
    setInvitationStatus(status);
    setInvitationPage(1);
    await loadInvitations(1, { status });
  }

  async function copyInvitationLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Invitation link copied to the clipboard.');
    } catch {
      setMessage('Could not copy the invitation link.');
    }
  }

  async function create() {
    const finalStep = formMode === 'edit' ? 5 : 6;
    if (formStep !== finalStep) {
      setFormStep(finalStep);
      setMessage(formMode === 'edit'
        ? 'Please confirm the timezone and currency before saving the company.'
        : 'Please confirm the timezone and currency before creating the company.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const profile = organizationProfilePayload(form);
      if (formMode === 'edit' && editingOrganizationId) {
        const result = await updateOrganization<{
          organization: Organization;
          invitation?: CreatedInvitation;
        }>(editingOrganizationId, profile);
        setInvitationPreview(result.invitation?.invitationUrl
          ? { id: result.invitation.id, invitationUrl: result.invitation.invitationUrl }
          : null);
        setMessage(result.invitation?.invitationUrl
          ? `Updated ${form.name}. A new admin invitation was sent to ${form.adminEmail}.`
          : `Updated ${form.name}.`);
        setForm({ ...INITIAL_FORM });
        setFormMode('create');
        setEditingOrganizationId(null);
        setFormStep(0);
        await load();
        return;
      }
      const result = await api<{
        organization: Organization;
        enabledModules: string[];
        invitation: CreatedInvitation;
      }>('/platform/organizations', {
        method: 'POST',
        body: JSON.stringify({
          ...profile,
          adminEmail: form.adminEmail,
          modules: selected,
        }),
      });
      setMessage(
        `Created ${result.organization.name}. Admin invitation: ${result.invitation.invitationUrl ?? 'sent by email'}`,
      );
      if (result.invitation.invitationUrl)
        setInvitationPreview({ id: result.invitation.id, invitationUrl: result.invitation.invitationUrl });
      setForm({ ...INITIAL_FORM });
      setFormMode('create');
      setEditingOrganizationId(null);
      setSelected([]);
      setFormStep(0);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Creation failed');
    } finally {
      setBusy(false);
    }
  }

  function editOrganization(org: Organization) {
    const ownerMobile = splitPhoneNumber(org.ownerMobile);
    const ownerAlternateNumber = splitPhoneNumber(org.ownerAlternateNumber);
    const primaryPhone = splitPhoneNumber(org.primaryPhone);
    const alternatePhone = splitPhoneNumber(org.alternatePhone);
    setForm({
      name: org.name,
      code: org.code,
      legalCompanyName: org.legalCompanyName,
      companyType: org.companyType,
      industry: org.industry,
      website: org.website,
      companyEmail: org.companyEmail,
      adminEmail: org.ownerEmail,
      ownerFullName: org.ownerFullName,
      ownerDesignation: org.ownerDesignation,
      ownerMobile: ownerMobile.number,
      ownerAlternateNumber: ownerAlternateNumber.number,
      phoneCountryCode: ownerMobile.countryCode,
      primaryPhone: primaryPhone.number,
      alternatePhone: alternatePhone.number,
      supportEmail: org.supportEmail,
      addressLine1: org.addressLine1,
      addressLine2: org.addressLine2,
      city: org.city,
      state: org.state,
      country: org.country,
      postalCode: org.postalCode,
      gstin: org.gstin,
      pan: org.pan,
      registrationNumber: org.registrationNumber,
      timezone: org.timezone,
      currency: org.currency,
    });
    setFormMode('edit');
    setEditingOrganizationId(org.id);
    setSelected([]);
    setFormStep(0);
    setMessage(`Editing ${org.name}.`);
  }

  function cancelEdit() {
    setForm({ ...INITIAL_FORM });
    setFormMode('create');
    setEditingOrganizationId(null);
    setFormStep(0);
    setMessage('');
  }

  function goNext() {
    const requiredByStep = [
      ['name', 'code', 'companyEmail'],
      ['ownerFullName', 'adminEmail', 'ownerMobile'],
      ['primaryPhone'],
      ['addressLine1', 'city', 'state', 'country', 'postalCode'],
      [],
      [],
    ] as const;
    const missing = requiredByStep[formStep]?.some((field) => !form[field].trim());
    if (missing) {
      setMessage('Please complete all required fields before continuing.');
      return;
    }
    if (formStep === 0 && (!COMPANY_CODE.test(form.code) || !isValidEmail(form.companyEmail) || (form.website && !isValidUrl(form.website)))) {
      setMessage('Enter a valid company code, company email, and website URL.');
      return;
    }
    if (formStep === 1 && (form.ownerFullName.trim().length < 2 || !isValidEmail(form.adminEmail))) {
      setMessage('Enter a valid owner name and admin email address.');
      return;
    }
    if (formStep === 1 && !TEN_DIGIT_PHONE.test(form.ownerMobile)) {
      setMessage('Owner mobile number must contain exactly 10 digits.');
      return;
    }
    if (formStep === 2 && (!TEN_DIGIT_PHONE.test(form.primaryPhone) || (form.alternatePhone && !TEN_DIGIT_PHONE.test(form.alternatePhone)) || (form.supportEmail && !isValidEmail(form.supportEmail)))) {
      setMessage('Enter valid 10-digit phone numbers and a valid support email.');
      return;
    }
    if (formStep === 3 && (!POSTAL_CODE.test(form.postalCode) || [form.addressLine1, form.city, form.state, form.country].some((value) => value.trim().length < 2))) {
      setMessage('Enter a valid address and postal code.');
      return;
    }
    setMessage('');
    setFormStep((step) => Math.min(step + 1, formMode === 'edit' ? 5 : 6));
  }

  async function toggleGroup(
    org: Organization,
    group: (typeof PLATFORM_GROUPS)[number],
    currentlyEnabled: boolean,
  ): Promise<boolean> {
    const actionKey = `${org.id}:${group.key}`;
    setModuleActionKey(actionKey);
    try {
      for (const key of group.moduleKeys) {
        await api(
          `/platform/organizations/${org.id}/modules/${encodeURIComponent(key)}/${currentlyEnabled ? 'disable' : 'enable'}`,
          { method: 'POST' },
        );
      }
      setMessage(`${group.label} ${currentlyEnabled ? 'disabled' : 'enabled'} for ${org.name}`);
      await load();
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Module update failed');
      return false;
    }
    finally {
      setModuleActionKey(null);
    }
  }

  async function removeCompany(org: Organization): Promise<boolean> {
    setDeletingId(org.id);
    setMessage('');
    try {
      await api(`/platform/organizations/${org.id}`, { method: 'DELETE' });
      setOrgs((current) => current.filter((company) => company.id !== org.id));
      setMessage(`${org.name} was suspended and removed from the current dashboard view. Company data was retained.`);
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Company removal failed');
      return false;
    } finally {
      setDeletingId(null);
    }
  }

  async function toggleCompanyStatus(org: Organization): Promise<boolean> {
    const nextStatus = org.status === 'active' ? 'suspended' : 'active';
    setStatusChangingId(org.id);
    setMessage('');
    try {
      const endpoint = nextStatus === 'suspended' ? 'suspend' : 'activate';
      await api(`/platform/organizations/${org.id}/${endpoint}`, { method: 'POST' });
      setMessage(`${org.name} is now ${nextStatus}.`);
      await load();
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Company status update failed');
      return false;
    } finally {
      setStatusChangingId(null);
    }
  }

  function groupStatus(org: Organization, group: (typeof PLATFORM_GROUPS)[number]) {
    const rows = entitlements[org.id] ?? [];
    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const statuses = group.moduleKeys.map((key) => rowByKey.get(key)?.status ?? 'disabled');
    if (statuses.every((status) => status === 'enabled')) return 'enabled' as const;
    if (statuses.every((status) => status === 'disabled')) return 'disabled' as const;
    return 'partial' as const;
  }

  const visibleOrganizations = orgs.filter((organization) => {
    const search = companySearch.trim().toLowerCase();
    if (!search) return true;
    return [organization.name, organization.code, organization.companyEmail]
      .some((value) => value.toLowerCase().includes(search));
  });

  return (
    <main className="min-h-screen bg-app-background px-5 pb-16 pt-[34px] text-app-foreground [background-image:radial-gradient(circle_at_86%_0%,rgba(244,139,60,0.09),transparent_28rem)] max-[560px]:px-[15px] max-[560px]:pb-[45px] max-[560px]:pt-6">
      <div className="mx-auto mb-5 max-w-[1320px] min-[561px]:hidden"><BrandLogo className="w-[180px]" /></div>
      <header className="mx-auto flex max-w-[1320px] items-start justify-between gap-7 max-[560px]:gap-3">
        <div className="flex items-start gap-[22px] max-[560px]:gap-[13px]">
          <div className="hidden items-center gap-2.5 font-display text-[17px] font-bold tracking-[-0.03em] text-app-muted min-[561px]:flex">
            <BrandLogo className="w-[200px]" />
          </div>
          <div>
            <p className="mb-[7px] text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">Master Admin</p>
            <h1 className="font-display text-[clamp(28px,4vw,42px)] leading-[1.05] tracking-[-0.045em] max-[560px]:text-[30px]">Platform Dashboard</h1>
            <p className="mt-[9px] text-sm text-app-muted max-[560px]:max-w-[230px]">Your companies, modules and access in one place.</p>
          </div>
        </div>
        <div className="flex items-center gap-[9px] max-[560px]:flex-col max-[560px]:items-stretch">
          <ThemeToggle />
          <button
            onClick={() => {
              clearTokens();
              onLogout();
            }}
            className="rounded-[9px] border border-app-border bg-app-surface px-4 py-2.5 text-app-foreground transition hover:border-app-accent hover:text-app-accent"
          >
            Logout
          </button>
        </div>
      </header>
      <section className="mx-auto mb-[22px] mt-[42px] grid max-w-[1320px] grid-cols-4 gap-[14px] max-[850px]:grid-cols-2 max-[560px]:mt-[30px] max-[560px]:gap-[9px]">
        {Object.entries(stats).filter(([k]) => !k.endsWith('_invitations')).map(([k, v]) => (
          <div className="relative min-h-[126px] overflow-hidden rounded-[14px] border border-app-border bg-[linear-gradient(145deg,var(--app-surface),var(--app-background))] p-5 shadow-[0_10px_30px_rgba(0,0,0,0.08)] max-[560px]:min-h-[108px] max-[560px]:p-[14px]" key={k}>
            <span className="block text-xs capitalize text-app-muted">{k.replaceAll('_', ' ')}</span>
            <strong className="mt-[13px] block font-display text-[30px] font-bold max-[560px]:text-2xl">{v}</strong>
            <span className="mt-[3px] block text-[11px] text-app-accent">Live platform data</span>
          </div>
        ))}
      </section>
      <section className="mx-auto grid max-w-[1320px] grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] items-start gap-[18px] max-[850px]:grid-cols-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="rounded-2xl border border-app-border bg-[linear-gradient(145deg,var(--app-surface),var(--app-background))] p-[27px] shadow-[0_20px_60px_rgba(0,0,0,0.14)] max-[560px]:p-[20px_16px]"
        >
          <div className="flex items-start justify-between gap-[15px]">
            <div>
              <p className="mb-[7px] text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">Provisioning</p>
              <h2 className="font-display text-[23px] tracking-[-0.045em]">{formMode === 'edit' ? 'Edit Company' : 'Create Company'}</h2>
            </div>
            <span className="grid size-[31px] place-items-center rounded-[9px] bg-app-accent text-[22px] text-app-background">+</span>
          </div>
          <p className="mt-[9px] text-sm text-app-muted">Set up a company workspace and invite its first administrator.</p>
          <div className={`grid gap-[3px] border-b border-app-border pb-[17px] pt-6 min-[561px]:gap-1 ${formMode === 'edit' ? 'grid-cols-6' : 'grid-cols-7'}`} aria-label={`Step ${formStep + 1} of ${formMode === 'edit' ? 6 : 7}`}>
            {(formMode === 'edit' ? ["Company", "Owner", "Contact", "Address", "Legal", "CRM"] : ["Company", "Owner", "Contact", "Address", "Legal", "CRM", "Modules"]).map((label, index) => (
              <div className={`relative flex min-w-0 items-center gap-1 text-[9px] ${index === formStep ? 'text-app-accent' : index < formStep ? 'text-app-muted' : 'text-[#5f717c]'} min-[561px]:gap-[7px] min-[561px]:text-[10px]`} key={label}>
                <span className={`grid size-[21px] shrink-0 place-items-center rounded-full border text-[10px] ${index <= formStep ? 'border-app-accent bg-app-accent text-app-background' : 'border-app-border'}`}>{index + 1}</span>
                <small className="truncate">{label}</small>
              </div>
            ))}
          </div>
          {formStep === 0 && <div className="mt-6 border-t border-app-border pt-[22px]">
            <div className="mb-[13px] font-display text-[13px] font-semibold uppercase tracking-[0.01em] text-app-foreground">1. Company Information</div>
            <div className="grid grid-cols-1 gap-x-3 min-[561px]:grid-cols-2">
              <TextField label="Company Name" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
              <TextField label="Company Code" value={form.code} onChange={(code) => setForm({ ...form, code })} required placeholder="ABC001" />
              <TextField label="Legal Company Name" value={form.legalCompanyName} onChange={(legalCompanyName) => setForm({ ...form, legalCompanyName })} />
              <SelectField label="Company Type" value={form.companyType} options={['Private', 'Public', 'Partnership', 'LLC', 'Other']} onChange={(companyType) => setForm({ ...form, companyType })} />
              <SelectField label="Industry" value={form.industry} options={['IT / Software', 'Finance', 'Healthcare', 'Education', 'Retail', 'Manufacturing', 'Other']} onChange={(industry) => setForm({ ...form, industry })} />
              <TextField label="Website" value={form.website} onChange={(website) => setForm({ ...form, website })} type="url" placeholder="https://example.com" />
              <TextField label="Company Email" value={form.companyEmail} onChange={(companyEmail) => setForm({ ...form, companyEmail })} type="email" required />
            </div>
          </div>}
          {formStep === 1 && <div className="mt-6 border-t border-app-border pt-[22px]">
            <div className="mb-[13px] font-display text-[13px] font-semibold uppercase tracking-[0.01em] text-app-foreground">2. Primary Owner / Company Admin</div>
            <div className="grid grid-cols-1 gap-x-3 min-[561px]:grid-cols-2">
              <TextField label="Full Name" value={form.ownerFullName} onChange={(ownerFullName) => setForm({ ...form, ownerFullName })} required />
              <TextField label="Designation" value={form.ownerDesignation} onChange={(ownerDesignation) => setForm({ ...form, ownerDesignation })} />
              <TextField label="Email" value={form.adminEmail} onChange={(adminEmail) => setForm({ ...form, adminEmail })} type="email" required />
              <PhoneField label="Mobile Number" value={form.ownerMobile} countryCode={form.phoneCountryCode} onChange={(ownerMobile) => setForm({ ...form, ownerMobile })} onCountryCodeChange={(phoneCountryCode) => setForm({ ...form, phoneCountryCode })} required />
              <PhoneField label="Alternate Number" value={form.ownerAlternateNumber} countryCode={form.phoneCountryCode} onChange={(ownerAlternateNumber) => setForm({ ...form, ownerAlternateNumber })} onCountryCodeChange={(phoneCountryCode) => setForm({ ...form, phoneCountryCode })} />
            </div>
          </div>}
          {formStep === 2 && <div className="mt-6 border-t border-app-border pt-[22px]">
            <div className="mb-[13px] font-display text-[13px] font-semibold uppercase tracking-[0.01em] text-app-foreground">3. Company Contact Details</div>
            <div className="grid grid-cols-1 gap-x-3 min-[561px]:grid-cols-2">
              <PhoneField label="Primary Phone" value={form.primaryPhone} countryCode={form.phoneCountryCode} onChange={(primaryPhone) => setForm({ ...form, primaryPhone })} onCountryCodeChange={(phoneCountryCode) => setForm({ ...form, phoneCountryCode })} required />
              <PhoneField label="Alternate Phone" value={form.alternatePhone} countryCode={form.phoneCountryCode} onChange={(alternatePhone) => setForm({ ...form, alternatePhone })} onCountryCodeChange={(phoneCountryCode) => setForm({ ...form, phoneCountryCode })} />
              <TextField label="Support Email" value={form.supportEmail} onChange={(supportEmail) => setForm({ ...form, supportEmail })} type="email" />
            </div>
          </div>}
          {formStep === 3 && <div className="mt-6 border-t border-app-border pt-[22px]">
            <div className="mb-[13px] font-display text-[13px] font-semibold uppercase tracking-[0.01em] text-app-foreground">4. Company Address</div>
            <div className="grid grid-cols-1 gap-x-3 min-[561px]:grid-cols-2">
              <TextField label="Address Line 1" value={form.addressLine1} onChange={(addressLine1) => setForm({ ...form, addressLine1 })} required />
              <TextField label="Address Line 2" value={form.addressLine2} onChange={(addressLine2) => setForm({ ...form, addressLine2 })} />
              <TextField label="City" value={form.city} onChange={(city) => setForm({ ...form, city })} required />
              <TextField label="State" value={form.state} onChange={(state) => setForm({ ...form, state })} required />
              <TextField label="Country" value={form.country} onChange={(country) => setForm({ ...form, country })} required />
              <TextField label="Postal / ZIP Code" value={form.postalCode} onChange={(postalCode) => setForm({ ...form, postalCode })} required />
            </div>
          </div>}
          {formStep === 4 && <div className="mt-6 border-t border-app-border pt-[22px]">
            <div className="mb-[13px] font-display text-[13px] font-semibold uppercase tracking-[0.01em] text-app-foreground">5. Business / Legal Details</div>
            <div className="grid grid-cols-1 gap-x-3 min-[561px]:grid-cols-2">
              <TextField label="GSTIN / Tax ID" value={form.gstin} onChange={(gstin) => setForm({ ...form, gstin })} />
              <TextField label="PAN / Business ID" value={form.pan} onChange={(pan) => setForm({ ...form, pan })} />
              <TextField label="Registration Number" value={form.registrationNumber} onChange={(registrationNumber) => setForm({ ...form, registrationNumber })} />
            </div>
          </div>}
          {formStep === 5 && <div className="mt-6 border-t border-app-border pt-[22px]">
            <div className="mb-[13px] font-display text-[13px] font-semibold uppercase tracking-[0.01em] text-app-foreground">6. CRM Configuration</div>
            <p className="mb-[14px] mt-1.5 text-xs text-app-muted">Confirm the regional settings for this company before {formMode === 'edit' ? 'saving it' : 'creating it'}.</p>
            <div className="grid grid-cols-1 gap-x-3 min-[561px]:grid-cols-2">
              <SelectField label="Timezone" value={form.timezone} options={['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London', 'Asia/Dubai', 'Asia/Singapore']} onChange={(timezone) => setForm({ ...form, timezone })} required />
              <SelectField label="Currency" value={form.currency} options={['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD']} onChange={(currency) => setForm({ ...form, currency })} required />
            </div>
          </div>}
          {formMode === 'create' && formStep === 6 && <>
          <div className="mt-[27px] text-[13px] font-bold text-app-foreground">Available modules</div>
          <p className="mb-[14px] mt-1.5 text-xs text-app-muted">
            Core identity and login modules are enabled automatically.
          </p>
          <div className="grid grid-cols-1 gap-[9px] min-[561px]:grid-cols-2">
            {PLATFORM_GROUPS.map((group) => (
              <label key={group.key} className="group flex min-h-[49px] cursor-pointer items-center gap-[9px] rounded-[9px] border border-app-border bg-app-background p-3 hover:border-[#3f5664] hover:bg-app-surface-raised">
                <input
                  className="peer sr-only"
                  type="checkbox"
                  checked={group.moduleKeys.every((key) => selected.includes(key))}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked) {
                        for (const key of group.moduleKeys) next.add(key);
                      } else {
                        for (const key of group.moduleKeys) next.delete(key);
                      }
                      return [...next];
                    })
                  }}
                />
                <span className="grid size-[18px] place-items-center rounded-[5px] border border-[#4e626d] text-xs text-transparent peer-checked:border-app-accent peer-checked:bg-app-accent peer-checked:text-app-background">✓</span>
                <strong>{group.label}</strong>
              </label>
            ))}
          </div>
          </>}
          <div className="mt-[22px] flex gap-2.5">
            {formStep > 0 && <button type="button" className="shrink-0 rounded-[9px] border border-app-border bg-app-surface px-4 py-2.5 text-app-foreground transition hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-55" onClick={() => setFormStep((step) => step - 1)} disabled={busy}>Back</button>}
            {formMode === 'edit' && <button type="button" className="shrink-0 rounded-[9px] border border-app-border bg-app-surface px-4 py-2.5 text-app-foreground transition hover:border-app-accent hover:text-app-accent" onClick={cancelEdit} disabled={busy}>Cancel</button>}
            {formStep < (formMode === 'edit' ? 5 : 6) ? (
              <button type="button" className="w-full rounded-[9px] bg-app-accent px-4 py-[13px] font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110" onClick={goNext}>Next</button>
            ) : (
              <button type="button" className="w-full rounded-[9px] bg-app-accent px-4 py-[13px] font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110 disabled:cursor-wait disabled:opacity-60" onClick={() => void create()} disabled={busy}>
                {busy ? (formMode === 'edit' ? 'Saving…' : 'Creating…') : formMode === 'edit' ? 'Save Changes' : 'Create Company & Invite Admin'}
              </button>
            )}
          </div>
          {message && <p className="mt-[14px] text-[13px] leading-6 text-app-accent">{message}</p>}
          {invitationPreview && <div className="mt-[15px] flex items-start justify-between gap-[14px] rounded-[9px] border border-app-accent/35 bg-app-accent/10 p-[13px] max-[560px]:flex-col">
            <div>
              <b className="mb-[7px] block text-[11px] uppercase text-app-accent">Development invitation preview</b>
              <span className="block break-words text-[11px] leading-5 text-app-muted"><strong className="mr-1.5 text-app-foreground">Invitation ID</strong>{invitationPreview.id}</span>
              <a className="mt-[5px] block break-words text-[11px] leading-5 text-app-foreground" href={invitationPreview.invitationUrl} target="_blank" rel="noreferrer">
                {invitationPreview.invitationUrl}
              </a>
            </div>
            <button type="button" className="shrink-0 rounded-[9px] border border-app-border bg-app-surface px-2.5 py-[7px] text-[11px] text-app-foreground transition hover:border-app-accent hover:text-app-accent" onClick={() => void copyInvitationLink(invitationPreview.invitationUrl)}>
              Copy link
            </button>
          </div>}
        </form>
        <section className="max-h-[720px] overflow-y-auto rounded-2xl border border-app-border bg-[linear-gradient(145deg,var(--app-surface),var(--app-background))] p-[27px] shadow-[0_20px_60px_rgba(0,0,0,0.14)] [scrollbar-color:#3f5664_transparent] [scrollbar-width:thin] max-[560px]:p-[20px_16px]">
          <div className="flex items-start justify-between gap-[15px]">
            <div>
              <p className="mb-[7px] text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">Tenant management</p>
              <h2 className="font-display text-[23px] tracking-[-0.045em]">Companies</h2>
            </div>
            <span className="rounded-full border border-app-border px-2.5 py-1.5 text-[11px] text-app-muted">{orgs.length} total</span>
          </div>
          <p className="mt-[9px] text-sm text-app-muted">Manage each company&apos;s available platform areas.</p>
          <input
            className="mt-[23px] mb-3 block w-full rounded-[9px] border border-app-border bg-app-background px-[13px] py-3 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
            value={companySearch}
            onChange={(event) => setCompanySearch(event.target.value)}
            placeholder="Search company name, code or email"
            aria-label="Search companies"
          />
          {visibleOrganizations.length === 0 ? (
            <p className="mt-[18px] text-sm text-app-muted">No companies match your search.</p>
          ) : visibleOrganizations.map((o) => (
            <article key={o.id} className="border-t border-app-border py-[17px] first:mt-[23px]">
              <div className="flex items-center gap-[11px]">
                <span className="grid size-[35px] place-items-center rounded-[10px] bg-app-accent/10 font-bold text-app-accent">{o.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong className="block text-sm">{o.name}</strong>
                  <small className="mt-[3px] block text-[11px] uppercase text-app-muted">
                  {o.code} · {o.status}
                  </small>
                </div>
              </div>
              <div className="mt-[-35px] flex justify-end gap-[7px]">
                <button
                  type="button"
                  className="rounded-lg border border-app-accent/30 bg-transparent px-2.5 py-[7px] text-[11px] text-app-accent hover:border-app-accent hover:bg-app-accent/10 disabled:cursor-wait disabled:opacity-55"
                  onClick={() => editOrganization(o)}
                  disabled={busy || moduleActionKey !== null || deletingId !== null || statusChangingId !== null}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`rounded-lg border bg-transparent px-2.5 py-[7px] text-[11px] ${o.status === 'active' ? 'border-[#f3c875]/30 text-[#f3c875] hover:border-[#f3c875] hover:bg-[#f3c875]/10' : 'border-app-accent/30 text-app-accent hover:border-app-accent hover:bg-app-accent/10'} disabled:cursor-wait disabled:opacity-55`}
                  onClick={() => setPendingCompanyAction({ type: 'status', org: o, nextStatus: o.status === 'active' ? 'suspended' : 'active' })}
                  disabled={statusChangingId === o.id || deletingId === o.id}
                >
                  {statusChangingId === o.id
                    ? 'Updating…'
                    : o.status === 'active' ? 'Suspend company' : 'Activate company'}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[#ff8d8d]/30 bg-transparent px-2.5 py-[7px] text-[11px] text-app-danger hover:border-[#ff8d8d] hover:bg-[#ff8d8d]/10 disabled:cursor-wait disabled:opacity-55"
                  onClick={() => setPendingCompanyAction({ type: 'delete', org: o })}
                  disabled={deletingId === o.id || statusChangingId === o.id}
                >
                  {deletingId === o.id ? 'Removing…' : 'Remove company'}
                </button>
              </div>
              <div className="mt-[14px] ml-[46px] flex flex-wrap gap-[7px] max-[560px]:ml-0">
                {PLATFORM_GROUPS.map((group) => {
                  const status = groupStatus(o, group);
                  const enabled = status === 'enabled';
                  return (
                    <button
                      type="button"
                      key={group.key}
                      className={`rounded-full border px-2.5 py-[7px] text-[11px] font-semibold ${status === 'enabled' ? 'border-app-accent/35 bg-app-accent/10 text-app-accent' : status === 'partial' ? 'border-[#f5c56b]/35 text-[#f5c56b]' : 'border-app-border text-app-muted'} hover:border-[#536975] hover:bg-app-surface-raised`}
                      onClick={() => setPendingModuleAction({ org: o, group, currentlyEnabled: enabled })}
                      disabled={moduleActionKey !== null}
                    >
                      {group.label}: {status}
                    </button>
                  );
                })}
              </div>
              <details className="mt-[15px] ml-[46px] text-xs text-app-muted max-[560px]:ml-0">
                <summary className="cursor-pointer text-app-accent hover:text-app-accent">View company details</summary>
                <div className="mt-[14px] grid gap-4">
                  <div>
                    <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.03em] text-app-foreground">Company Information</h3>
                    <div className="mt-[13px] grid grid-cols-2 gap-3 rounded-[9px] border border-app-border bg-app-background p-[14px] max-[560px]:grid-cols-1">
                      <span className="min-w-0 break-words leading-5"><b className="mb-[3px] block text-[10px] uppercase tracking-[0.08em] text-app-foreground">Company name</b>{o.name}</span>
                      <span><b>Company code</b>{o.code}</span>
                      <span><b>Legal name</b>{o.legalCompanyName || 'Not provided'}</span>
                      <span><b>Company type</b>{o.companyType}</span>
                      <span><b>Industry</b>{o.industry}</span>
                      <span><b>Website</b>{o.website || 'Not provided'}</span>
                      <span><b>Company email</b>{o.companyEmail}</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.03em] text-app-foreground">Primary Owner / Admin</h3>
                    <div className="mt-[13px] grid grid-cols-2 gap-3 rounded-[9px] border border-app-border bg-app-background p-[14px] max-[560px]:grid-cols-1">
                      <span className="min-w-0 break-words leading-5"><b className="mb-[3px] block text-[10px] uppercase tracking-[0.08em] text-app-foreground">Full name</b>{o.ownerFullName}</span>
                      <span><b>Designation</b>{o.ownerDesignation || 'Not provided'}</span>
                      <span><b>Email</b>{o.ownerEmail}</span>
                      <span><b>Mobile number</b>{o.ownerMobile}</span>
                      <span><b>Alternate number</b>{o.ownerAlternateNumber || 'Not provided'}</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.03em] text-app-foreground">Contact & Address</h3>
                    <div className="mt-[13px] grid grid-cols-2 gap-3 rounded-[9px] border border-app-border bg-app-background p-[14px] max-[560px]:grid-cols-1">
                      <span className="min-w-0 break-words leading-5"><b className="mb-[3px] block text-[10px] uppercase tracking-[0.08em] text-app-foreground">Primary phone</b>{o.primaryPhone}</span>
                      <span><b>Alternate phone</b>{o.alternatePhone || 'Not provided'}</span>
                      <span><b>Support email</b>{o.supportEmail || 'Not provided'}</span>
                      <span><b>Address</b>{[o.addressLine1, o.addressLine2, o.city, o.state, o.country, o.postalCode].filter(Boolean).join(', ')}</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.03em] text-app-foreground">Legal & CRM</h3>
                    <div className="mt-[13px] grid grid-cols-2 gap-3 rounded-[9px] border border-app-border bg-app-background p-[14px] max-[560px]:grid-cols-1">
                      <span className="min-w-0 break-words leading-5"><b className="mb-[3px] block text-[10px] uppercase tracking-[0.08em] text-app-foreground">GSTIN / Tax ID</b>{o.gstin || 'Not provided'}</span>
                      <span><b>PAN / Business ID</b>{o.pan || 'Not provided'}</span>
                      <span><b>Registration number</b>{o.registrationNumber || 'Not provided'}</span>
                      <span><b>Timezone</b>{o.timezone}</span>
                      <span><b>Currency</b>{o.currency}</span>
                    </div>
                  </div>
                </div>
              </details>
            </article>
          ))}
        </section>
      </section>
      <section className="mx-auto mt-[18px] max-h-[720px] w-full max-w-[1320px] overflow-y-auto rounded-2xl border border-app-border bg-[linear-gradient(145deg,var(--app-surface),var(--app-background))] p-[27px] shadow-[0_20px_60px_rgba(0,0,0,0.14)] [scrollbar-color:#3f5664_transparent] [scrollbar-width:thin] max-[560px]:p-[20px_16px]">
        <div className="flex items-start justify-between gap-[15px]">
          <div>
            <p className="mb-[7px] text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">Access lifecycle</p>
            <h2 className="font-display text-[23px] tracking-[-0.045em]">Admin Invitations</h2>
          </div>
          <span className="rounded-full border border-app-border px-2.5 py-1.5 text-[11px] text-app-muted">{invitationTotal} total</span>
        </div>
        <div className="mt-[23px] grid grid-cols-[minmax(0,1fr)_170px_auto] gap-2.5 max-[560px]:grid-cols-1">
          <input
            className="block w-full rounded-[9px] border border-app-border bg-app-background px-[13px] py-3 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
            value={invitationSearch}
            onChange={(event) => setInvitationSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void applyInvitationFilters();
              }
            }}
            placeholder="Search company, code or admin email"
            aria-label="Search invitations"
          />
          <select
            className="block w-full cursor-pointer rounded-[9px] border border-app-border bg-app-background px-[13px] py-3 text-app-foreground outline-none focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
            value={invitationStatus}
            onChange={(event) => {
              void changeInvitationStatus(event.target.value);
            }}
            aria-label="Filter invitations by status"
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="EXPIRED">Expired</option>
            <option value="REVOKED">Revoked</option>
          </select>
          <button type="button" className="rounded-[9px] border border-app-border bg-app-surface px-4 py-2.5 text-app-foreground transition hover:border-app-accent hover:text-app-accent" onClick={() => void applyInvitationFilters()}>
            Search
          </button>
        </div>
        <div className="mt-[18px]">
          {invitations.length === 0 ? (
            <p className="mt-[9px] text-sm text-app-muted">No invitations match the current filters.</p>
          ) : invitations.map((invitation) => {
            const canResend = (invitation.status === 'PENDING' || invitation.status === 'EXPIRED') && invitation.companyStatus === 'active';
            const canRevoke = invitation.status === 'PENDING';
            const canResetPassword = invitation.status === 'ACCEPTED' && invitation.companyStatus === 'active';
            return (
              <article className="grid grid-cols-[minmax(190px,1.2fr)_auto_minmax(300px,1.5fr)_auto] items-start gap-[15px] border-t border-app-border py-[17px] max-[850px]:grid-cols-1" key={invitation.id}>
                <div>
                  <strong className="block text-sm text-app-foreground">{invitation.companyName}</strong>
                  <small className="mt-1 block text-[11px] text-app-muted">{invitation.companyCode} · {invitation.adminName}</small>
                  <span className="mt-1 block text-[11px] text-app-muted">{invitation.adminEmail}</span>
                </div>
                <span className={`rounded-full border px-2 py-1.5 text-[10px] font-bold tracking-[0.04em] ${invitation.status === 'PENDING' ? 'border-app-accent/35 bg-app-accent/10 text-orange-400' : invitation.status === 'ACCEPTED' ? 'border-[#8dd7ff]/30 text-[#8dd7ff]' : invitation.status === 'EXPIRED' ? 'border-[#f5c56b]/35 text-[#f5c56b]' : 'border-[#ff8d8d]/30 text-app-danger'}`}>{invitation.status}</span>
                <div className="grid grid-cols-4 gap-[9px] text-[11px] text-app-muted max-[560px]:grid-cols-2">
                  <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Created</b>{formatDate(invitation.createdAt)}</span>
                  <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Expires</b>{formatDate(invitation.expiresAt)}</span>
                  <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Last sent</b>{formatDate(invitation.lastSentAt)}</span>
                  <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Resends</b>{invitation.resendCount}</span>
                </div>
                <div className="flex flex-wrap justify-end gap-[7px] max-[850px]:justify-start">
                  <button type="button" className="rounded-[9px] border border-app-border bg-app-surface px-[9px] py-[7px] text-[11px] text-app-foreground transition hover:border-app-accent hover:text-app-accent" onClick={() => setViewInvitationId((current) => current === invitation.id ? null : invitation.id)}>
                    {viewInvitationId === invitation.id ? 'Hide' : 'View'}
                  </button>
                  {canResend && <button type="button" className="rounded-[9px] border border-app-border bg-app-surface px-[9px] py-[7px] text-[11px] text-app-foreground transition hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-55" onClick={() => void resendInvitation(invitation)} disabled={invitationActionId === invitation.id}>
                    {invitationActionId === invitation.id ? 'Resending…' : 'Resend Invitation'}
                  </button>}
                  {canResetPassword && <button type="button" className="rounded-[9px] border border-app-border bg-app-surface px-[9px] py-[7px] text-[11px] text-app-foreground transition hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-55" onClick={() => void sendAdminPasswordReset(invitation)} disabled={invitationActionId === invitation.id}>
                    {invitationActionId === invitation.id ? 'Sending…' : 'Send password reset'}
                  </button>}
                  {canRevoke && <button type="button" className="rounded-[9px] border border-[#ff8d8d]/30 bg-transparent px-[9px] py-[7px] text-[11px] text-app-danger hover:border-[#ff8d8d] hover:bg-[#ff8d8d]/10 disabled:cursor-wait disabled:opacity-55" onClick={() => void revokeInvitation(invitation)} disabled={invitationActionId === invitation.id}>
                    {invitationActionId === invitation.id ? 'Revoking…' : 'Revoke'}
                  </button>}
                </div>
                {viewInvitationId === invitation.id && <div className="col-span-full grid grid-cols-3 gap-2.5 rounded-[9px] border border-app-border bg-app-background p-[13px] text-[11px] text-app-muted max-[560px]:grid-cols-1">
                  <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Company status</b>{invitation.companyStatus}</span>
                  <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Invitation ID</b>{invitation.id}</span>
                  <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Admin email</b>{invitation.adminEmail}</span>
                  {invitationPreview?.id === invitation.id && <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Development link</b><a className="text-app-accent" href={invitationPreview.invitationUrl} target="_blank" rel="noreferrer">Open invitation link</a></span>}
                </div>}
              </article>
            );
          })}
        </div>
        {invitationTotal > 25 && <div className="mt-4 flex items-center justify-end gap-3 text-xs text-app-muted">
          <button type="button" className="rounded-[9px] border border-app-border bg-app-surface px-2.5 py-[7px] text-[11px] text-app-foreground transition hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-55" onClick={() => { const page = invitationPage - 1; setInvitationPage(page); void loadInvitations(page); }} disabled={invitationPage <= 1}>Previous</button>
          <span>Page {invitationPage} of {Math.ceil(invitationTotal / 25)}</span>
          <button type="button" className="rounded-[9px] border border-app-border bg-app-surface px-2.5 py-[7px] text-[11px] text-app-foreground transition hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-55" onClick={() => { const page = invitationPage + 1; setInvitationPage(page); void loadInvitations(page); }} disabled={invitationPage >= Math.ceil(invitationTotal / 25)}>Next</button>
        </div>}
      </section>
      {pendingModuleAction && <ModuleToggleModal
        companyName={pendingModuleAction.org.name}
        moduleName={pendingModuleAction.group.label}
        action={pendingModuleAction.currentlyEnabled ? 'Disable' : 'Enable'}
        variant={pendingModuleAction.currentlyEnabled ? 'warning' : 'accent'}
        busy={moduleActionKey !== null}
        onCancel={() => setPendingModuleAction(null)}
        onConfirm={() => {
          void toggleGroup(
            pendingModuleAction.org,
            pendingModuleAction.group,
            pendingModuleAction.currentlyEnabled,
          ).then((success) => {
            if (success) setPendingModuleAction(null);
          });
        }}
      />}
      {pendingCompanyAction && <ModuleToggleModal
        companyName={pendingCompanyAction.org.name}
        moduleName="company"
        action={pendingCompanyAction.type === 'delete'
          ? 'Remove'
          : pendingCompanyAction.nextStatus === 'suspended' ? 'Suspend' : 'Activate'}
        title={pendingCompanyAction.type === 'delete'
          ? 'Remove company?'
          : `${pendingCompanyAction.nextStatus === 'suspended' ? 'Suspend' : 'Activate'} company?`}
        eyebrow="Tenant management"
        variant={pendingCompanyAction.type === 'delete' ? 'danger' : 'warning'}
        actionLabel={pendingCompanyAction.type === 'delete'
          ? 'Remove company'
          : pendingCompanyAction.nextStatus === 'suspended' ? 'Suspend company' : 'Activate company'}
        message={pendingCompanyAction.type === 'delete'
          ? <>Remove <strong className="text-app-foreground">{pendingCompanyAction.org.name}</strong> from this dashboard? It will be suspended and its company data will be retained.</>
          : pendingCompanyAction.nextStatus === 'suspended'
            ? <>Suspend <strong className="text-app-foreground">{pendingCompanyAction.org.name}</strong>? Company data will be kept, but its users will not be able to use the CRM.</>
            : <>Activate <strong className="text-app-foreground">{pendingCompanyAction.org.name}</strong>? Users will be able to use the CRM again.</>}
        busy={pendingCompanyAction.type === 'delete'
          ? deletingId === pendingCompanyAction.org.id
          : statusChangingId === pendingCompanyAction.org.id}
        onCancel={() => setPendingCompanyAction(null)}
        onConfirm={() => {
          const action = pendingCompanyAction;
          const operation = action.type === 'delete'
            ? removeCompany(action.org)
            : toggleCompanyStatus(action.org);
          void operation.then((success) => {
            if (success) setPendingCompanyAction(null);
          });
        }}
      />}
    </main>
  );
}
