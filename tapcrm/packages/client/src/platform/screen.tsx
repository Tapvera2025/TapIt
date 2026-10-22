import { BrandLogo } from '../ui/BrandLogo.js';
import { useEffect, useState } from 'react';
import { api, ApiError, clearTokens, saveTokens, updateOrganization } from './api.js';
import { ModuleToggleModal } from './ModuleToggleModal.js';
import { ThemeToggle } from '../theme/ThemeToggle.js';
import { ACCENT_COLORS, useTheme } from '../theme/ThemeContext.js';
import { Icon } from '../ui/Icon.js';

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

type PlatformKpiVisual = 'line' | 'bars' | 'dots' | 'ring' | 'steps' | 'checkline' | 'xline' | 'hourglass' | 'shieldbars';

const PLATFORM_KPI_META: Record<string, {
  label: string;
  description: string;
  icon: string;
  visual: PlatformKpiVisual;
}> = {
  total_organizations: { label: 'Total organizations', description: 'Total registered organizations', icon: 'building', visual: 'line' },
  active_organizations: { label: 'Active organizations', description: 'Organizations currently active', icon: 'users', visual: 'steps' },
  suspended_organizations: { label: 'Suspended organizations', description: 'Organizations currently suspended', icon: 'pause', visual: 'dots' },
  pending_invitations: { label: 'Pending invitations', description: 'Pending organization invitations', icon: 'inbox', visual: 'ring' },
  total_invitations: { label: 'Total invitations', description: 'Total invitations sent', icon: 'user-plus', visual: 'bars' },
  accepted_invitations: { label: 'Accepted invitations', description: 'Invitations accepted', icon: 'check', visual: 'checkline' },
  revoked_invitations: { label: 'Revoked invitations', description: 'Invitations revoked', icon: 'close', visual: 'xline' },
  expired_invitations: { label: 'Expired invitations', description: 'Invitations expired', icon: 'clock', visual: 'hourglass' },
  platform_admins: { label: 'Platform admins', description: 'Total platform administrators', icon: 'shield', visual: 'shieldbars' },
};

function PlatformKpiCard({ statKey, value }: { statKey: string; value: number }): React.JSX.Element {
  const normalizedKey = statKey.replace(/([A-Z])/g, '_$1').toLowerCase();
  const meta = PLATFORM_KPI_META[normalizedKey] ?? {
    label: normalizedKey.replaceAll('_', ' '),
    description: 'Live platform data',
    icon: 'chart',
    visual: 'line' as const,
  };

  return (
    <article className="group relative flex h-[150px] min-h-[150px] min-w-0 flex-col overflow-hidden rounded-2xl border border-app-accent/20 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--app-accent)_6%,transparent),color-mix(in_srgb,var(--app-surface)_58%,transparent))] p-4 shadow-[0_12px_30px_color-mix(in_srgb,var(--app-accent)_5%,transparent)] backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-app-accent/45 max-[700px]:h-[172px] max-[700px]:min-h-[172px]">
      <div className="pointer-events-none absolute -right-8 -top-10 size-24 rounded-full bg-app-accent/10 blur-2xl" />
      <div className="relative flex min-w-0 items-start gap-2.5">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-app-accent/35 bg-transparent text-app-accent">
            <Icon name={meta.icon} className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="max-w-[14rem] whitespace-normal break-words text-xs font-semibold leading-4 text-app-foreground">{meta.label}</p>
            <strong className="mt-0.5 block font-display text-2xl font-bold tracking-tight text-app-foreground">{value}</strong>
            <p className="mt-0.5 max-w-[14rem] text-[11px] leading-4 text-app-muted">{meta.description}</p>
          </div>
        </div>
      </div>
      <div className="relative mt-auto flex items-center gap-2 pt-2 text-[11px] text-app-muted">
        <span className="inline-flex items-center gap-1 rounded-full bg-app-accent/15 px-2 py-0.5 font-semibold text-app-accent">
          <Icon name="arrow" className="size-2.5" /> Live
        </span>
        <span>Platform data</span>
      </div>
    </article>
  );
}

const PLATFORM_GROUPS = [
  { key: 'hr', label: 'HR', moduleKeys: ['employee-directory', 'onboarding', 'live-status', 'attendance', 'break-management', 'shifts', 'biometric', 'leave', 'holidays', 'payroll', 'performance', 'recruitment'] },
  { key: 'sales', label: 'Sales', moduleKeys: ['territories', 'leads', 'callbacks', 'handovers', 'deals', 'approvals'] },
  { key: 'development', label: 'Development', moduleKeys: ['handoff', 'projects', 'tasks', 'resource-planning', 'delivery'] },
  { key: 'client', label: 'Client', moduleKeys: ['clients', 'post-closure', 'client-portal'] },
  { key: 'finance', label: 'Finance', moduleKeys: ['billing-terms', 'invoicing', 'payments', 'receivables', 'payables', 'accounting'] },
] as const;

function CompanyDetailsDialog({ org, entitlements, onClose }: { org: Organization; entitlements: Entitlement[]; onClose: () => void }): React.JSX.Element {
  const sections: Array<{ title: string; icon: string; fields: Array<[string, string]> }> = [
    { title: 'Company information', icon: 'building', fields: [['Company name', org.name], ['Company code', org.code], ['Legal name', org.legalCompanyName || 'Not provided'], ['Company type', org.companyType], ['Industry', org.industry], ['Website', org.website || 'Not provided'], ['Company email', org.companyEmail]] },
    { title: 'Primary owner / admin', icon: 'users', fields: [['Full name', org.ownerFullName], ['Designation', org.ownerDesignation || 'Not provided'], ['Email', org.ownerEmail], ['Mobile number', org.ownerMobile], ['Alternate number', org.ownerAlternateNumber || 'Not provided']] },
    { title: 'Contact & address', icon: 'pin', fields: [['Primary phone', org.primaryPhone], ['Alternate phone', org.alternatePhone || 'Not provided'], ['Support email', org.supportEmail || 'Not provided'], ['Address', [org.addressLine1, org.addressLine2, org.city, org.state, org.country, org.postalCode].filter(Boolean).join(', ') || 'Not provided']] },
    { title: 'Legal & CRM', icon: 'shield', fields: [['GSTIN / Tax ID', org.gstin || 'Not provided'], ['PAN / Business ID', org.pan || 'Not provided'], ['Registration number', org.registrationNumber || 'Not provided'], ['Timezone', org.timezone], ['Currency', org.currency]] },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 py-6 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto overflow-x-hidden rounded-3xl border border-app-accent/25 bg-app-surface text-app-foreground shadow-[0_24px_90px_rgba(0,0,0,0.35)]" role="dialog" aria-modal="true" aria-labelledby="company-details-title">
        <div className="relative overflow-hidden border-b border-app-accent/20 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--app-accent)_16%,var(--app-surface)),color-mix(in_srgb,var(--app-background)_82%,var(--app-surface)))] px-6 py-6 sm:px-8 sm:py-7">
          <div className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-app-accent/10 blur-3xl" />
          <div className="relative flex items-start justify-between gap-5">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-app-accent text-2xl font-bold text-app-on-accent shadow-[0_10px_30px_color-mix(in_srgb,var(--app-accent)_28%,transparent)] sm:size-16">{org.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-app-accent">Tenant details</p>
                <h2 id="company-details-title" className="truncate font-display text-2xl font-bold tracking-[-0.04em] sm:text-3xl">{org.name}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-app-muted">
                  <span className="rounded-full border border-app-border bg-app-background/40 px-2.5 py-1 font-semibold">{org.code}</span>
                  <span className={`rounded-full border px-2.5 py-1 font-semibold ${org.status === 'active' ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-500' : 'border-[#ff8d8d]/30 bg-[#ff8d8d]/10 text-app-danger'}`}>{org.status}</span>
                  <span className="inline-flex items-center gap-1"><Icon name="clock" className="size-3.5" />{org.timezone}</span>
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} className="relative grid size-10 shrink-0 place-items-center rounded-full border border-app-border bg-app-background/45 text-app-muted transition hover:border-app-accent hover:bg-app-accent/10 hover:text-app-accent" aria-label="Close company details"><Icon name="close" className="size-5" /></button>
          </div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:gap-5 sm:p-7">
          {sections.map((section) => (
            <div key={section.title} className="rounded-2xl border border-app-accent/15 bg-[color-mix(in_srgb,var(--app-accent)_3%,var(--app-background))] p-4 sm:p-5">
              <div className="flex items-center gap-2.5 border-b border-app-border/70 pb-3">
                <span className="grid size-8 place-items-center rounded-lg bg-app-accent/10 text-app-accent"><Icon name={section.icon} className="size-4" /></span>
                <h3 className="font-display text-sm font-semibold">{section.title}</h3>
              </div>
              <dl className="mt-4 grid gap-x-4 gap-y-4 text-sm sm:grid-cols-2">
                {section.fields.map(([label, value]) => <div key={label} className={label === 'Address' ? 'sm:col-span-2' : ''}><dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-app-muted">{label}</dt><dd className="mt-1 break-words leading-5 text-app-foreground">{value}</dd></div>)}
              </dl>
            </div>
          ))}
          <div className="rounded-2xl border border-app-accent/15 bg-[color-mix(in_srgb,var(--app-accent)_3%,var(--app-background))] p-4 sm:col-span-2 sm:p-5">
          <div className="flex items-center gap-2.5 border-b border-app-border/70 pb-3">
            <span className="grid size-8 place-items-center rounded-lg bg-app-accent/10 text-app-accent"><Icon name="layers" className="size-4" /></span>
            <div><h3 className="font-display text-sm font-semibold">Platform areas</h3><p className="mt-0.5 text-xs text-app-muted">Enabled modules and access areas for this tenant</p></div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PLATFORM_GROUPS.map((group) => {
              const enabled = group.moduleKeys.filter((key) => entitlements.some((row) => row.key === key && row.status === 'enabled')).length;
              const status = enabled === group.moduleKeys.length ? 'Enabled' : enabled > 0 ? 'Partially enabled' : 'Disabled';
              return <span key={group.key} className={`inline-flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold ${status === 'Enabled' ? 'border-app-accent/35 bg-app-accent/10 text-app-accent' : status === 'Partially enabled' ? 'border-[#f5c56b]/35 bg-[#f5c56b]/10 text-[#f5c56b]' : 'border-app-border bg-app-background/35 text-app-muted'}`}><span>{group.label}</span><span className="text-[10px] opacity-80">{status}</span></span>;
            })}
          </div>
        </div>
        </div>
      </section>
    </div>
  );
}
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

type FormErrors = {
  name?: string; code?: string; companyEmail?: string; website?: string; ownerFullName?: string;
  adminEmail?: string; ownerMobile?: string; primaryPhone?: string; alternatePhone?: string;
  supportEmail?: string; addressLine1?: string; city?: string; state?: string; country?: string; postalCode?: string;
  [key: string]: string | undefined;
};

function validationMessage(field: string, issue: string) {
  const labels: Record<string, string> = {
    name: 'Company name', code: 'Company code', companyEmail: 'Company email', ownerFullName: 'Owner name',
    adminEmail: 'Owner/admin email', ownerMobile: 'Mobile number', primaryPhone: 'Primary phone',
    addressLine1: 'Address line 1', city: 'City', state: 'State', country: 'Country', postalCode: 'Postal code',
    website: 'Website', supportEmail: 'Support email',
  };
  const label = labels[field] ?? field;
  if (issue.toLowerCase().includes('required') || issue.toLowerCase().includes('too_small')) return `${label} is required.`;
  if (field === 'code') return 'Company code can contain only letters, numbers, underscores, and hyphens.';
  if (field.toLowerCase().includes('email')) return `Enter a valid ${label.toLowerCase()}.`;
  return issue;
}

function apiFieldErrors(error: unknown): FormErrors {
  if (!(error instanceof ApiError)) return {};
  const details = error.details as { fields?: Record<string, string>; issues?: Array<{ path?: string[]; message?: string }> } | undefined;
  if (details?.fields) return details.fields;
  return Object.fromEntries((details?.issues ?? []).flatMap((issue) => {
    const field = issue.path?.[0];
    return field ? [[field, validationMessage(field, issue.message ?? 'Invalid value')]] : [];
  }));
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
  error,
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
  error?: string | undefined;
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
        aria-invalid={Boolean(error)}
      />
      {error && <span className="mt-1 block text-xs text-app-danger" role="alert">{error}</span>}
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
  error,
}: {
  label: string;
  value: string;
  countryCode: string;
  onChange: (value: string) => void;
  onCountryCodeChange: (value: string) => void;
  required?: boolean;
  error?: string | undefined;
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
          aria-invalid={Boolean(error)}
        />
      </div>
      {error && <span className="mt-1 block text-xs text-app-danger" role="alert">{error}</span>}
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
        className="relative w-full max-w-[440px] rounded-[22px] border border-app-border bg-app-surface p-8 shadow-[0_24px_80px_rgba(0,0,0,0.14)] max-[560px]:p-6"
      >
        <ThemeToggle compact className="absolute right-5 top-5 max-[560px]:right-4 max-[560px]:top-4" />
        <div className="mb-9 pr-12">
          <BrandLogo className="w-[200px]" />
        </div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-app-accent">Control panel</p>
        <h1 className="font-display text-[clamp(30px,7vw,42px)] font-bold leading-none tracking-[-0.05em]">Welcome back.</h1>
        <p className="mt-3 text-sm leading-6 text-app-muted">Sign in to manage companies, access and platform modules.</p>
        <label className="mt-7 block">
          <span className="mb-2 block text-xs font-semibold text-app-muted">Email address</span>
          <input
            className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
            placeholder="admin@example.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-semibold text-app-muted">Password</span>
          <span className="relative block">
            <input
              className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 pr-12 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
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
          </span>
        </label>
        {error && <p className="mt-4 rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-3 py-2.5 text-sm text-app-danger" role="alert">{error}</p>}
        <button className="mt-6 w-full rounded-[10px] bg-app-accent px-4 py-3 font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110 disabled:cursor-wait disabled:opacity-60" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

function AppearanceModeIcon({ mode }: { mode: 'light' | 'dark' }) {
  return mode === 'light' ? (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ) : (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z" />
    </svg>
  );
}

function PlatformAppearancePopover({
  onLogout,
  onClose,
  mobile = false,
}: {
  onLogout: () => void;
  onClose: () => void;
  mobile?: boolean;
}) {
  const { accent, resolvedTheme, setAccent, setTheme } = useTheme();

  return (
    <div
      className={`platform-appearance-popover ${mobile ? 'w-full' : 'absolute right-0 top-[calc(100%+0.75rem)] z-40 w-[min(30rem,calc(100vw-2rem))]'} rounded-[22px] border border-app-border bg-app-surface-raised/95 p-4 text-app-foreground shadow-[0_24px_70px_rgba(0,0,0,0.18)] backdrop-blur-xl max-[560px]:rounded-[20px] max-[560px]:p-3.5`}
      role="dialog"
      aria-label="Appearance settings"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-app-accent/20 bg-app-accent/10 text-app-accent">
            <Icon name="settings" className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold tracking-[-0.01em]">Appearance</h2>
            <p className="mt-0.5 text-xs text-app-muted">Choose your theme and color</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-app-border text-app-muted transition hover:border-app-accent/40 hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent"
          aria-label="Close appearance settings"
        >
          <Icon name="chevron-up" className="size-4" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 max-[420px]:grid-cols-1">
        {([
          { mode: 'light' as const, label: 'Light Mode', description: 'Clean and bright' },
          { mode: 'dark' as const, label: 'Dark Mode', description: 'Easy on your eyes' },
        ]).map(({ mode, label, description }) => {
          const selected = resolvedTheme === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setTheme(mode)}
              aria-pressed={selected}
              className={`platform-appearance-mode-card flex items-center gap-3 rounded-2xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-app-accent ${selected ? 'border-app-accent/60 bg-app-accent/10 text-app-foreground ring-1 ring-inset ring-app-accent/25' : 'border-app-border bg-app-background/35 text-app-foreground hover:border-app-accent/35 hover:bg-app-accent/5'}`}
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${selected ? 'bg-app-accent text-app-on-accent' : 'bg-app-surface text-app-muted'}`}>
                <AppearanceModeIcon mode={mode} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="mt-0.5 block text-xs text-app-muted">{description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 border-t border-app-border/70 pt-4">
        <p className="text-sm font-semibold">Accent Color</p>
        <p className="mt-0.5 text-xs text-app-muted">Change the highlight color</p>
        <div className="mt-3 flex flex-wrap gap-2.5" role="radiogroup" aria-label="Accent color">
          {ACCENT_COLORS.map((color) => {
            const selected = accent === color.id;
            return (
              <button
                key={color.id}
                type="button"
                onClick={() => setAccent(color.id)}
                className={`group inline-flex items-center gap-2 rounded-xl border px-2.5 py-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-app-accent ${selected ? 'border-app-accent/50 bg-app-accent/10 text-app-foreground' : 'border-app-border bg-app-background/30 text-app-muted hover:border-app-accent/35 hover:text-app-foreground'}`}
                role="radio"
                aria-checked={selected}
                aria-label={`${color.label} accent${selected ? ', selected' : ''}`}
              >
                <span
                  className={`size-4 rounded-full ${selected ? 'ring-2 ring-app-surface ring-offset-1 ring-offset-app-accent' : ''}`}
                  style={{ backgroundColor: color.hex }}
                />
                <span>{color.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onLogout}
        className="mt-5 flex w-full items-center gap-3 rounded-2xl border border-rose-300/25 bg-rose-500/[0.07] p-3 text-left transition hover:border-rose-400/45 hover:bg-rose-500/[0.12] focus-visible:outline-2 focus-visible:outline-rose-400"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-500">
          <Icon name="logout" className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Sign out from your account</span>
          <span className="mt-0.5 block text-xs text-app-muted">Log out of the platform dashboard</span>
        </span>
        <Icon name="chevron-right" className="size-4 text-rose-500" />
      </button>
    </div>
  );
}

export function PlatformDashboard({ onLogout }: { onLogout: () => void }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('platform-overview');
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [entitlements, setEntitlements] = useState<Record<string, Entitlement[]>>({});
  const [stats, setStats] = useState<Record<string, number>>({});
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<Organization | null>(null);
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
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingOrganizationId, setEditingOrganizationId] = useState<string | null>(null);
  const [companyFormOpen, setCompanyFormOpen] = useState(false);
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

  useEffect(() => {
    if (!appearanceOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.platform-appearance-popover, .platform-appearance-anchor')) return;
      setAppearanceOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [appearanceOpen]);

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInvitationPage(1);
      void loadInvitations(1, { search: invitationSearch, status: invitationStatus });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [invitationSearch]);

  useEffect(() => {
    const sectionIds = ['platform-overview', 'platform-companies', 'platform-invitations'] as const;
    const updateActiveSection = () => {
      const current = sectionIds.reduce<string>((active, sectionId) => {
        const section = document.getElementById(sectionId);
        return section && section.getBoundingClientRect().top <= 180 ? sectionId : active;
      }, sectionIds[0]);
      setActiveSection(current);
    };

    updateActiveSection();
    window.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);
    return () => {
      window.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
    };
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
    setFormErrors({});
    setInvitationPreview(null);
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
        setCompanyFormOpen(false);
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
      setCompanyFormOpen(false);
      await load();
    } catch (err) {
      const fieldErrors = apiFieldErrors(err);
      setFormErrors(fieldErrors);
      setMessage(Object.keys(fieldErrors).length ? 'Please correct the highlighted fields.' : err instanceof Error ? err.message : 'Creation failed');
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
    setFormErrors({});
    setCompanyFormOpen(true);
  }

  function startCreateCompany(): void {
    setForm({ ...INITIAL_FORM });
    setFormMode('create');
    setEditingOrganizationId(null);
    setSelected([]);
    setFormStep(0);
    setMessage('');
    setFormErrors({});
    setInvitationPreview(null);
    setCompanyFormOpen(true);
  }

  function cancelEdit() {
    setForm({ ...INITIAL_FORM });
    setFormMode('create');
    setEditingOrganizationId(null);
    setFormStep(0);
    setMessage('');
    setFormErrors({});
    setCompanyFormOpen(false);
  }

  function setFormField(field: string, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
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
    const errors: FormErrors = {};
    for (const field of requiredByStep[formStep] ?? []) if (!form[field].trim()) errors[field] = validationMessage(field, 'required');
    if (formStep === 0) {
      if (form.code.trim() && (!COMPANY_CODE.test(form.code) || form.code.trim().length < 2)) errors['code'] = validationMessage('code', 'format');
      if (form.companyEmail.trim() && !isValidEmail(form.companyEmail)) errors['companyEmail'] = validationMessage('companyEmail', 'format');
      if (form.website.trim() && !isValidUrl(form.website)) errors['website'] = 'Enter a valid website URL.';
    }
    if (formStep === 1) {
      if (form.ownerFullName.trim() && form.ownerFullName.trim().length < 2) errors['ownerFullName'] = 'Owner name must contain at least 2 characters.';
      if (form.adminEmail.trim() && !isValidEmail(form.adminEmail)) errors['adminEmail'] = validationMessage('adminEmail', 'format');
      if (form.ownerMobile.trim() && !TEN_DIGIT_PHONE.test(form.ownerMobile)) errors['ownerMobile'] = 'Mobile number must contain exactly 10 digits.';
    }
    if (formStep === 2) {
      if (form.primaryPhone.trim() && !TEN_DIGIT_PHONE.test(form.primaryPhone)) errors['primaryPhone'] = 'Primary phone must contain exactly 10 digits.';
      if (form.alternatePhone && !TEN_DIGIT_PHONE.test(form.alternatePhone)) errors['alternatePhone'] = 'Alternate phone must contain exactly 10 digits.';
      if (form.supportEmail && !isValidEmail(form.supportEmail)) errors['supportEmail'] = 'Enter a valid support email.';
    }
    if (formStep === 3) {
      if (form.postalCode.trim() && !POSTAL_CODE.test(form.postalCode)) errors['postalCode'] = 'Enter a valid postal code.';
      for (const field of ['addressLine1', 'city', 'state', 'country'] as const) if (form[field].trim() && form[field].trim().length < 2) errors[field] = `${field === 'addressLine1' ? 'Address line 1' : field[0]!.toUpperCase() + field.slice(1)} must contain at least 2 characters.`;
    }
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      setMessage('Please correct the highlighted fields before continuing.');
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

  const logout = (): void => {
    clearTokens();
    onLogout();
  };

  const platformNavigation = [
    { id: 'platform-overview', label: 'Platform Dashboard', icon: 'grid' },
    { id: 'platform-companies', label: 'Companies', icon: 'building' },
    { id: 'platform-invitations', label: 'Admin Invitations', icon: 'users' },
  ] as const;

  const renderPlatformNavigation = (mobile = false) => (
    <nav aria-label="Master Admin navigation" className={mobile ? 'grid gap-1.5 sm:grid-cols-3' : 'grid gap-1.5'}>
      {platformNavigation.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={activeSection === item.id ? 'location' : undefined}
          onClick={() => {
            setActiveSection(item.id);
            setMobileNavOpen(false);
          }}
          className={`group relative flex min-h-[42px] min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-1.5 py-1 text-[9px] font-semibold transition duration-200 focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2 ${activeSection === item.id ? 'border-app-accent/50 bg-[linear-gradient(110deg,color-mix(in_srgb,var(--app-accent)_24%,var(--app-surface)),color-mix(in_srgb,var(--app-accent)_8%,var(--app-background)))] text-app-foreground shadow-[0_8px_20px_color-mix(in_srgb,var(--app-accent)_14%,transparent)]' : 'border-app-border/40 bg-[color-mix(in_srgb,var(--app-foreground)_10%,var(--app-background))] text-app-muted hover:border-app-accent/25 hover:bg-app-surface hover:text-app-foreground'}`}
        >
          <span className={`grid size-6 shrink-0 place-items-center rounded-md border transition ${activeSection === item.id ? 'border-app-accent/40 bg-app-accent text-app-on-accent shadow-[0_7px_16px_color-mix(in_srgb,var(--app-accent)_30%,transparent)]' : 'border-app-border bg-app-surface text-app-muted group-hover:border-app-accent/30 group-hover:text-app-accent'}`}>
            <Icon name={item.icon} className="size-2.5" />
          </span>
          <span className="min-w-0 flex-1 break-words leading-4">{item.label}</span>
          <span className={`grid size-4 shrink-0 place-items-center rounded-full transition ${activeSection === item.id ? 'bg-app-accent/15 text-app-accent' : 'bg-app-surface text-app-muted group-hover:text-app-accent'}`}>
            <Icon name="chevron-right" className="size-2" />
          </span>
        </a>
      ))}
    </nav>
  );

  return (
    <main className="min-h-screen bg-app-background px-[clamp(12px,2.2vw,24px)] pb-16 pt-[clamp(16px,2.5vw,24px)] text-app-foreground [background-image:radial-gradient(circle_at_86%_0%,rgba(244,139,60,0.09),transparent_28rem)] max-[560px]:pb-10">
      <header className="relative mx-auto grid w-full max-w-[1480px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 rounded-xl border border-app-border bg-app-surface px-4 py-3 max-[850px]:gap-x-3 max-[700px]:grid-cols-[auto_minmax(0,1fr)] max-[700px]:items-start max-[700px]:px-3.5 max-[700px]:py-2.5 max-[560px]:rounded-lg max-[560px]:px-2.5">
        <button
          type="button"
          onClick={() => setMobileNavOpen((open) => !open)}
          className="col-start-1 row-start-1 grid size-8 shrink-0 place-items-center rounded-lg border border-app-border bg-app-background text-app-foreground transition hover:border-app-accent hover:text-app-accent min-[851px]:hidden"
          aria-label={mobileNavOpen ? 'Close platform navigation' : 'Open platform navigation'}
          aria-expanded={mobileNavOpen}
          aria-controls="platform-mobile-navigation"
        >
          <Icon name={mobileNavOpen ? 'close' : 'menu'} className="size-4" />
        </button>
        <div className="col-start-2 row-start-1 flex min-w-0 items-center min-[851px]:col-start-1">
          <BrandLogo className="w-[145px] max-[850px]:w-[128px] max-[560px]:w-[108px]" />
        </div>
        <div className="col-start-1 col-span-3 row-start-2 min-w-0 min-[851px]:col-start-2 min-[851px]:col-span-1 min-[851px]:row-start-1">
          <p className="mb-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-app-accent">Master Admin</p>
          <h1 className="font-display text-[clamp(18px,2vw,23px)] leading-[1.05] tracking-[-0.045em]">Platform Dashboard</h1>
          <p className="mt-0.5 text-[10px] text-app-muted sm:text-[11px]">Your companies, modules and access in one place.</p>
        </div>
        <div className="platform-header-actions col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-1.5 max-[700px]:col-start-2 max-[700px]:row-start-1 max-[700px]:justify-self-end max-[560px]:gap-1">
          <ThemeToggle compact className="platform-theme-toggle" />
          <div className="platform-appearance-anchor relative">
            <button
              type="button"
              onClick={() => setAppearanceOpen((open) => !open)}
              className="platform-appearance-button grid size-8 place-items-center rounded-lg border border-app-border bg-app-background text-app-muted transition hover:border-app-accent hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2"
              aria-label="Appearance settings"
              aria-expanded={appearanceOpen}
              aria-haspopup="dialog"
            >
              <Icon name="settings" className="size-4" />
            </button>
            {appearanceOpen && (
              <PlatformAppearancePopover onLogout={logout} onClose={() => setAppearanceOpen(false)} />
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto mt-7 flex max-w-[1480px] items-start gap-6 max-[850px]:mt-5 max-[850px]:block">
        <aside className="sticky top-5 hidden w-[190px] shrink-0 rounded-xl border border-app-border bg-app-surface p-2 min-[851px]:block">
          <p className="mb-1.5 px-2 pt-1 text-[8px] font-bold uppercase tracking-[0.14em] text-app-muted">Platform</p>
          {renderPlatformNavigation()}
        </aside>
        <div className="min-w-0 flex-1">
          {mobileNavOpen && (
            <div id="platform-mobile-navigation" className="mb-5 rounded-2xl border border-app-border bg-app-surface p-3 min-[851px]:hidden">
              {renderPlatformNavigation(true)}
            </div>
          )}
          <section id="platform-overview" className="mb-[22px] scroll-mt-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-app-accent">Overview</p>
                <h2 className="font-display text-xl font-semibold tracking-[-0.03em]">Platform Overview</h2>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <span className="text-xs text-app-muted">Live platform data</span>
                <button type="button" className="rounded-xl bg-app-accent px-5 py-3 text-sm font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110" onClick={startCreateCompany}>
                  + Create company
                </button>
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-[14px] max-[560px]:gap-[10px]">
              {Object.entries(stats).map(([k, v]) => <PlatformKpiCard key={k} statKey={k} value={v} />)}
            </div>
          </section>
      <section className="scroll-mt-5" aria-label="Company provisioning and management">
        {companyFormOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 px-4 py-6 backdrop-blur-sm" role="presentation">
            <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-app-border bg-app-background shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
              <div className="flex items-start justify-between gap-4 border-b border-app-border px-6 py-5 max-[560px]:px-4">
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-app-accent">Provisioning</p>
                  <h2 className="font-display text-xl tracking-[-0.04em]">{formMode === 'edit' ? 'Edit company' : 'Create company'}</h2>
                  <p className="mt-1 text-xs text-app-muted">Complete the company details and regional setup.</p>
                </div>
                <button
                  type="button"
                  className="grid size-9 shrink-0 place-items-center rounded-xl border border-app-border text-xl text-app-muted transition hover:border-app-accent hover:text-app-accent disabled:opacity-50"
                  onClick={() => setCompanyFormOpen(false)}
                  disabled={busy}
                  aria-label="Close company form"
                >
                  ×
                </button>
              </div>
        <form
          id="platform-create-company"
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="bg-[linear-gradient(145deg,var(--app-surface),var(--app-background))] p-6 max-[560px]:p-4"
        >
            <div className="flex items-start justify-between gap-[15px] max-[700px]:flex-col">
            <div>
              <p className="mb-[7px] text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">Provisioning</p>
              <h2 className="font-display text-[23px] tracking-[-0.045em]">{formMode === 'edit' ? 'Edit Company' : 'Create Company'}</h2>
            </div>
            <span className="grid size-[31px] place-items-center rounded-[9px] bg-app-accent text-[22px] text-app-background">+</span>
          </div>
          <p className="mt-[9px] text-sm text-app-muted">Set up a company workspace and invite its first administrator.</p>
          <div className={`grid gap-[3px] border-b border-app-border pb-[17px] pt-6 min-[561px]:gap-1 max-[560px]:grid-cols-3 max-[560px]:gap-y-2.5 ${formMode === 'edit' ? 'grid-cols-6' : 'grid-cols-7'}`} aria-label={`Step ${formStep + 1} of ${formMode === 'edit' ? 6 : 7}`}>
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
              <TextField label="Company Name" value={form.name} onChange={(name) => setFormField('name', name)} error={formErrors.name} required />
              <TextField label="Company Code" value={form.code} onChange={(code) => setFormField('code', code)} error={formErrors.code} required placeholder="ABC001" />
              <TextField label="Legal Company Name" value={form.legalCompanyName} onChange={(legalCompanyName) => setFormField('legalCompanyName', legalCompanyName)} />
              <SelectField label="Company Type" value={form.companyType} options={['Private', 'Public', 'Partnership', 'LLC', 'Other']} onChange={(companyType) => setForm({ ...form, companyType })} />
              <SelectField label="Industry" value={form.industry} options={['IT / Software', 'Finance', 'Healthcare', 'Education', 'Retail', 'Manufacturing', 'Other']} onChange={(industry) => setForm({ ...form, industry })} />
              <TextField label="Website" value={form.website} onChange={(website) => setFormField('website', website)} error={formErrors.website} type="url" placeholder="https://example.com" />
              <TextField label="Company Email" value={form.companyEmail} onChange={(companyEmail) => setFormField('companyEmail', companyEmail)} error={formErrors.companyEmail} type="email" required />
            </div>
          </div>}
          {formStep === 1 && <div className="mt-6 border-t border-app-border pt-[22px]">
            <div className="mb-[13px] font-display text-[13px] font-semibold uppercase tracking-[0.01em] text-app-foreground">2. Primary Owner / Company Admin</div>
            <div className="grid grid-cols-1 gap-x-3 min-[561px]:grid-cols-2">
              <TextField label="Full Name" value={form.ownerFullName} onChange={(ownerFullName) => setFormField('ownerFullName', ownerFullName)} error={formErrors.ownerFullName} required />
              <TextField label="Designation" value={form.ownerDesignation} onChange={(ownerDesignation) => setForm({ ...form, ownerDesignation })} />
              <TextField label="Email" value={form.adminEmail} onChange={(adminEmail) => setFormField('adminEmail', adminEmail)} error={formErrors.adminEmail} type="email" required />
              <PhoneField label="Mobile Number" value={form.ownerMobile} countryCode={form.phoneCountryCode} onChange={(ownerMobile) => setFormField('ownerMobile', ownerMobile)} onCountryCodeChange={(phoneCountryCode) => setFormField('phoneCountryCode', phoneCountryCode)} error={formErrors.ownerMobile} required />
              <PhoneField label="Alternate Number" value={form.ownerAlternateNumber} countryCode={form.phoneCountryCode} onChange={(ownerAlternateNumber) => setForm({ ...form, ownerAlternateNumber })} onCountryCodeChange={(phoneCountryCode) => setForm({ ...form, phoneCountryCode })} />
            </div>
          </div>}
          {formStep === 2 && <div className="mt-6 border-t border-app-border pt-[22px]">
            <div className="mb-[13px] font-display text-[13px] font-semibold uppercase tracking-[0.01em] text-app-foreground">3. Company Contact Details</div>
            <div className="grid grid-cols-1 gap-x-3 min-[561px]:grid-cols-2">
              <PhoneField label="Primary Phone" value={form.primaryPhone} countryCode={form.phoneCountryCode} onChange={(primaryPhone) => setFormField('primaryPhone', primaryPhone)} onCountryCodeChange={(phoneCountryCode) => setFormField('phoneCountryCode', phoneCountryCode)} error={formErrors.primaryPhone} required />
              <PhoneField label="Alternate Phone" value={form.alternatePhone} countryCode={form.phoneCountryCode} onChange={(alternatePhone) => setForm({ ...form, alternatePhone })} onCountryCodeChange={(phoneCountryCode) => setForm({ ...form, phoneCountryCode })} />
              <TextField label="Support Email" value={form.supportEmail} onChange={(supportEmail) => setFormField('supportEmail', supportEmail)} error={formErrors.supportEmail} type="email" />
            </div>
          </div>}
          {formStep === 3 && <div className="mt-6 border-t border-app-border pt-[22px]">
            <div className="mb-[13px] font-display text-[13px] font-semibold uppercase tracking-[0.01em] text-app-foreground">4. Company Address</div>
            <div className="grid grid-cols-1 gap-x-3 min-[561px]:grid-cols-2">
              <TextField label="Address Line 1" value={form.addressLine1} onChange={(addressLine1) => setFormField('addressLine1', addressLine1)} error={formErrors.addressLine1} required />
              <TextField label="Address Line 2" value={form.addressLine2} onChange={(addressLine2) => setForm({ ...form, addressLine2 })} />
              <TextField label="City" value={form.city} onChange={(city) => setFormField('city', city)} error={formErrors.city} required />
              <TextField label="State" value={form.state} onChange={(state) => setFormField('state', state)} error={formErrors.state} required />
              <TextField label="Country" value={form.country} onChange={(country) => setFormField('country', country)} error={formErrors.country} required />
              <TextField label="Postal / ZIP Code" value={form.postalCode} onChange={(postalCode) => setFormField('postalCode', postalCode)} error={formErrors.postalCode} required />
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
            </div>
          </div>
        )}
        <section id="platform-companies" className="w-full scroll-mt-5 rounded-2xl border border-app-accent/20 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--app-accent)_5%,var(--app-background)),color-mix(in_srgb,var(--app-surface)_72%,var(--app-background)))] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.14)] max-[560px]:p-[20px_16px]">
          <div className="flex items-start justify-between gap-[15px]">
            <div>
              <p className="mb-[7px] text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">Tenant management</p>
              <h2 className="font-display text-[23px] tracking-[-0.045em]">Companies</h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 max-[700px]:w-full max-[700px]:justify-start">
              <span className="rounded-full border border-app-border px-2.5 py-1.5 text-[11px] text-app-muted">{orgs.length} total</span>
              <button type="button" className="rounded-xl bg-app-accent px-5 py-3 text-sm font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110" onClick={startCreateCompany}>
                + Create company
              </button>
            </div>
          </div>
          <p className="mt-[9px] text-sm text-app-muted">Manage each company&apos;s available platform areas.</p>
          <div className="relative mt-5 mb-3 rounded-2xl border border-app-accent/20 bg-app-background/45 p-2 shadow-[0_8px_24px_rgba(0,0,0,0.08)] transition focus-within:border-app-accent/50 focus-within:ring-4 focus-within:ring-app-accent/10">
            <Icon name="search" className="pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-app-accent" />
            <input
              className="block w-full rounded-xl border border-transparent bg-transparent py-3 pl-11 pr-11 text-sm text-app-foreground outline-none placeholder:text-app-muted"
              value={companySearch}
              onChange={(event) => setCompanySearch(event.target.value)}
              placeholder="Search company name, code or email"
              aria-label="Search companies"
            />
            {companySearch && <button type="button" className="absolute right-4 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-app-muted transition hover:bg-app-accent/10 hover:text-app-accent" onClick={() => setCompanySearch('')} aria-label="Clear company search">
              <Icon name="close" className="size-4" />
            </button>}
          </div>
          {visibleOrganizations.length === 0 ? (
            <p className="mt-[18px] text-sm text-app-muted">No companies match your search.</p>
          ) : (
            <div className="mt-5 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {visibleOrganizations.map((o) => (
                <article key={o.id} className="flex min-h-[300px] flex-col rounded-2xl border border-app-accent/20 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--app-accent)_5%,var(--app-background)),color-mix(in_srgb,var(--app-surface)_72%,var(--app-background)))] p-5 shadow-[0_12px_30px_rgba(0,0,0,0.08)] transition hover:-translate-y-0.5 hover:border-app-accent/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-app-accent/12 text-lg font-bold text-app-accent">{o.name.slice(0, 1).toUpperCase()}</span>
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-lg font-bold">{o.name}</h3>
                        <p className="mt-1 text-xs uppercase tracking-wide text-app-muted">{o.code} · <span className={o.status === 'active' ? 'text-app-accent' : 'text-app-danger'}>{o.status}</span></p>
                      </div>
                    </div>
                    <span className="rounded-full border border-app-border px-2 py-1 text-[10px] font-semibold text-app-muted">{o.timezone}</span>
                  </div>
                  <div className="mt-5 grid gap-2 text-xs text-app-muted sm:grid-cols-2">
                    <span className="truncate">✉ {o.ownerEmail}</span>
                    <span className="truncate">⌖ {[o.city, o.country].filter(Boolean).join(', ') || 'Location not provided'}</span>
                  </div>
                  <div className="mt-5">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-app-muted">Platform areas</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {PLATFORM_GROUPS.map((group) => {
                        const status = groupStatus(o, group);
                        return <button type="button" key={group.key} className={`w-full rounded-xl border px-3 py-2 text-left text-[10px] font-semibold ${status === 'enabled' ? 'border-app-accent/35 bg-app-accent/10 text-app-accent' : status === 'partial' ? 'border-[#f5c56b]/35 bg-[#f5c56b]/[0.04] text-[#f5c56b]' : 'border-app-border text-app-muted'} hover:border-app-accent`} onClick={() => setPendingModuleAction({ org: o, group, currentlyEnabled: status === 'enabled' })} disabled={moduleActionKey !== null}>{group.label}: {status}</button>;
                      })}
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-2 border-t border-app-border pt-4 sm:grid-cols-4">
                    <button type="button" className="col-span-2 min-h-11 rounded-xl bg-app-accent px-3 py-2.5 text-xs font-bold text-app-on-accent transition hover:brightness-110 sm:col-span-1" onClick={() => setSelectedCompany(o)}>View details</button>
                    <button type="button" className="min-h-11 rounded-xl border border-app-accent/30 px-3 py-2.5 text-xs font-semibold text-app-accent transition hover:bg-app-accent/10" onClick={() => editOrganization(o)} disabled={busy || moduleActionKey !== null || deletingId !== null || statusChangingId !== null}>Edit</button>
                    <button type="button" className="min-h-11 rounded-xl border border-app-border px-3 py-2.5 text-xs text-app-muted transition hover:border-app-accent hover:text-app-accent" onClick={() => setPendingCompanyAction({ type: 'status', org: o, nextStatus: o.status === 'active' ? 'suspended' : 'active' })} disabled={statusChangingId === o.id || deletingId === o.id}>{o.status === 'active' ? 'Suspend' : 'Activate'}</button>
                    <button type="button" className="min-h-11 rounded-xl border border-[#ff8d8d]/30 px-3 py-2.5 text-xs text-app-danger transition hover:border-[#ff8d8d]" onClick={() => setPendingCompanyAction({ type: 'delete', org: o })} disabled={deletingId === o.id || statusChangingId === o.id}>{deletingId === o.id ? 'Removing…' : 'Remove'}</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
      <section id="platform-invitations" className="mx-auto mt-[18px] w-full scroll-mt-5 rounded-2xl border border-app-accent/20 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--app-accent)_5%,var(--app-background)),color-mix(in_srgb,var(--app-surface)_72%,var(--app-background)))] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.14)] max-[560px]:p-[20px_16px]">
        <div className="flex items-end justify-between gap-5 max-[700px]:flex-col max-[700px]:items-start">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-app-accent">Access lifecycle</p>
            <h2 className="font-display text-[clamp(24px,3vw,32px)] font-bold tracking-[-0.045em]">Admin Invitations</h2>
            <p className="mt-1.5 text-sm text-app-muted">Manage and track invitation status for company administrators.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-app-accent/30 bg-app-accent/10 px-4 py-2 text-xs font-semibold text-app-accent max-[700px]:self-start"><Icon name="users" className="size-4" />{invitationTotal} total</span>
        </div>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_190px_auto] gap-3 rounded-2xl border border-app-accent/20 bg-app-background/45 p-3 max-[700px]:grid-cols-1">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-app-muted" />
            <input
              className="block w-full rounded-xl border border-app-border bg-app-background py-3 pl-10 pr-3 text-sm text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
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
          </div>
          <div className="relative">
            <Icon name="filter" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-app-muted" />
            <select
              className="block w-full cursor-pointer rounded-xl border border-app-border bg-app-background py-3 pl-9 pr-3 text-sm text-app-foreground outline-none focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
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
          </div>
          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-app-accent px-5 py-3 text-sm font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110" onClick={() => void applyInvitationFilters()}>
            <Icon name="search" className="size-4" />
            Search
          </button>
        </div>
        <div className="mt-6 overflow-hidden rounded-2xl border border-app-accent/20 bg-app-background/35">
          <div className="hidden grid-cols-[minmax(220px,1.1fr)_minmax(190px,0.9fr)_minmax(260px,1.25fr)_auto] gap-5 border-b border-app-border px-5 py-4 text-[11px] font-bold uppercase tracking-[0.1em] text-app-muted lg:grid">
            <span>Company &amp; admin</span><span>Status</span><span>Timeline</span><span>Actions</span>
          </div>
          <div>
          {invitations.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-app-muted">No invitations match the current filters.</p>
          ) : invitations.map((invitation) => {
            const canResend = (invitation.status === 'PENDING' || invitation.status === 'EXPIRED') && invitation.companyStatus === 'active';
            const canRevoke = invitation.status === 'PENDING';
            const canResetPassword = invitation.status === 'ACCEPTED' && invitation.companyStatus === 'active';
            // The View action is always available; optional actions are rendered inside the same compact column.
            const hasActions = true;
            const statusIcon = invitation.status === 'ACCEPTED' ? 'check' : invitation.status === 'PENDING' ? 'clock' : invitation.status === 'EXPIRED' ? 'alert-circle' : 'close';
            return (
              <article className={`grid ${hasActions ? 'grid-cols-[minmax(220px,1.1fr)_minmax(190px,0.9fr)_minmax(260px,1.25fr)_auto]' : 'grid-cols-[minmax(220px,1.1fr)_minmax(190px,0.9fr)_minmax(260px,1.25fr)]'} items-start justify-items-start gap-5 border-b border-app-border p-5 text-left last:border-b-0 max-[1100px]:grid-cols-2 max-[1100px]:items-start max-[700px]:grid-cols-1`} key={invitation.id}>
                <div className="min-w-0 justify-self-start">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-app-accent/15 text-lg font-bold text-app-accent">{invitation.companyName.slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0">
                      <strong className="block truncate text-base font-bold text-app-foreground">{invitation.companyName}</strong>
                      <small className="mt-1 block text-xs text-app-muted">{invitation.companyCode}</small>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-app-muted">
                    <span className="flex min-w-0 items-center gap-1.5 truncate"><Icon name="inbox" className="size-3.5 shrink-0" />{invitation.adminEmail}</span>
                    <span className="flex items-center gap-1.5"><Icon name="user-plus" className="size-3.5 shrink-0" />Admin · {invitation.adminName}</span>
                  </div>
                </div>
                <div className="min-w-0 justify-self-start">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold tracking-[0.05em] ${invitation.status === 'PENDING' ? 'border-app-accent/35 bg-app-accent/10 text-orange-400' : invitation.status === 'ACCEPTED' ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-500' : invitation.status === 'EXPIRED' ? 'border-[#f5c56b]/35 bg-[#f5c56b]/10 text-[#f5c56b]' : 'border-[#ff8d8d]/30 bg-[#ff8d8d]/10 text-app-danger'}`}><Icon name={statusIcon} className="size-3.5" />{invitation.status}</span>
                  <p className="mt-2 text-xs leading-5 text-app-muted">{invitation.status === 'ACCEPTED' ? 'Invitation accepted and admin account is active.' : invitation.status === 'PENDING' ? 'Invitation is awaiting acceptance.' : invitation.status === 'EXPIRED' ? 'Invitation has expired.' : 'Invitation has been revoked.'}</p>
                  <span className="mt-2 inline-flex rounded-full border border-app-accent/20 bg-app-accent/10 px-2 py-0.5 text-[9px] font-semibold text-app-accent">{invitation.companyStatus === 'active' ? 'Active company' : 'Suspended company'}</span>
                </div>
                <div className="grid w-full grid-cols-4 justify-items-start gap-3 text-left text-xs text-app-muted max-[560px]:grid-cols-2">
                  <span><b className="mb-1 flex items-center gap-1 text-[9px] uppercase tracking-[0.07em] text-app-foreground"><Icon name="calendar" className="size-3" />Created</b>{formatDate(invitation.createdAt)}</span>
                  <span><b className="mb-1 flex items-center gap-1 text-[9px] uppercase tracking-[0.07em] text-app-foreground"><Icon name="clock" className="size-3" />Expires</b>{formatDate(invitation.expiresAt)}</span>
                  <span><b className="mb-1 flex items-center gap-1 text-[9px] uppercase tracking-[0.07em] text-app-foreground"><Icon name="forward" className="size-3" />Last sent</b>{formatDate(invitation.lastSentAt)}</span>
                  <span><b className="mb-1 flex items-center gap-1 text-[9px] uppercase tracking-[0.07em] text-app-foreground"><Icon name="refresh" className="size-3" />Resends</b>{invitation.resendCount}</span>
                </div>
                {hasActions && <div className="flex flex-wrap justify-start gap-2 justify-self-start max-[1100px]:col-span-2 max-[1100px]:justify-start max-[700px]:col-span-1">
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-app-accent/35 bg-app-surface px-3 py-2.5 text-xs font-semibold text-app-foreground transition hover:border-app-accent hover:text-app-accent" onClick={() => setViewInvitationId((current) => current === invitation.id ? null : invitation.id)}>
                    <Icon name="eye" className="size-3.5" />
                    {viewInvitationId === invitation.id ? 'Hide' : 'View'}
                  </button>
                  {canResend && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-xs text-app-foreground transition hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-55" onClick={() => void resendInvitation(invitation)} disabled={invitationActionId === invitation.id}>
                    <Icon name="refresh" className="size-3.5" />
                    {invitationActionId === invitation.id ? 'Resending…' : 'Resend Invitation'}
                  </button>}
                  {canResetPassword && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl bg-app-accent px-3 py-2.5 text-xs font-bold text-app-on-accent transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55" onClick={() => void sendAdminPasswordReset(invitation)} disabled={invitationActionId === invitation.id}>
                    <Icon name="shield" className="size-3.5" />
                    {invitationActionId === invitation.id ? 'Sending…' : 'Send password reset'}
                  </button>}
                  {canRevoke && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-[#ff8d8d]/30 bg-transparent px-3 py-2.5 text-xs text-app-danger hover:border-[#ff8d8d] hover:bg-[#ff8d8d]/10 disabled:cursor-wait disabled:opacity-55" onClick={() => void revokeInvitation(invitation)} disabled={invitationActionId === invitation.id}>
                    <Icon name="close" className="size-3.5" />
                    {invitationActionId === invitation.id ? 'Revoking…' : 'Revoke'}
                  </button>}
                </div>}
                {viewInvitationId === invitation.id && <div className="col-span-full grid grid-cols-3 gap-3 rounded-xl border border-app-accent/20 bg-app-background p-4 text-xs text-app-muted max-[560px]:grid-cols-1">
                  <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Company status</b>{invitation.companyStatus}</span>
                  <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Invitation ID</b>{invitation.id}</span>
                  <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Admin email</b>{invitation.adminEmail}</span>
                  {invitationPreview?.id === invitation.id && <span><b className="mb-[3px] block text-[9px] uppercase tracking-[0.07em] text-app-foreground">Development link</b><a className="text-app-accent" href={invitationPreview.invitationUrl} target="_blank" rel="noreferrer">Open invitation link</a></span>}
                </div>}
              </article>
            );
          })}
          </div>
        </div>
        {invitationTotal > 25 && <div className="mt-4 flex items-center justify-end gap-3 text-xs text-app-muted">
          <button type="button" className="rounded-[9px] border border-app-border bg-app-surface px-2.5 py-[7px] text-[11px] text-app-foreground transition hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-55" onClick={() => { const page = invitationPage - 1; setInvitationPage(page); void loadInvitations(page); }} disabled={invitationPage <= 1}>Previous</button>
          <span>Page {invitationPage} of {Math.ceil(invitationTotal / 25)}</span>
          <button type="button" className="rounded-[9px] border border-app-border bg-app-surface px-2.5 py-[7px] text-[11px] text-app-foreground transition hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-55" onClick={() => { const page = invitationPage + 1; setInvitationPage(page); void loadInvitations(page); }} disabled={invitationPage >= Math.ceil(invitationTotal / 25)}>Next</button>
        </div>}
      </section>
        </div>
      </div>
      {selectedCompany && <CompanyDetailsDialog org={selectedCompany} entitlements={entitlements[selectedCompany.id] ?? []} onClose={() => setSelectedCompany(null)} />}
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
