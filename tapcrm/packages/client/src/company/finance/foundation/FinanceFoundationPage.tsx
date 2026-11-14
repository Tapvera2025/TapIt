import { useEffect, useState } from 'react';
import { Button, Card, Loading, Notice, Page } from '../../../ui/components.js';
import { getFinanceFoundation, updateFinanceFoundation, type FinanceFoundation } from './foundationApi.js';
import { PaymentGatewaysCard } from '../payments/PaymentGatewaysCard.js';
import { ReconciliationSettingsCard } from './ReconciliationSettingsCard.js';

const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Unable to complete the Finance settings request.';

export function FinanceFoundationPage({ organizationId }: { organizationId: string }): React.JSX.Element {
  const [data, setData] = useState<FinanceFoundation | null>(null);
  const [legalName, setLegalName] = useState('');
  const [countryCode, setCountryCode] = useState('IN');
  const [functionalCurrency, setFunctionalCurrency] = useState('INR');
  const [supportedCurrencies, setSupportedCurrencies] = useState('INR,AUD');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState('4');
  const [status, setStatus] = useState<FinanceFoundation['status']>('pending_review');
  const [taxPolicyStatus, setTaxPolicyStatus] = useState<FinanceFoundation['taxPolicyStatus']>('pending_review');
  const [statutorySourceStatus, setStatutorySourceStatus] = useState<FinanceFoundation['statutorySourceStatus']>('pending_review');
  const [revenuePolicyStatus, setRevenuePolicyStatus] = useState<FinanceFoundation['revenuePolicyStatus']>('pending_review');
  const [paymentProviderStatus, setPaymentProviderStatus] = useState<FinanceFoundation['paymentProviderStatus']>('pending_review');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const apply = (next: FinanceFoundation) => {
    setData(next);
    setLegalName(next.legalName);
    setCountryCode(next.countryCode);
    setFunctionalCurrency(next.functionalCurrency);
    setSupportedCurrencies(next.supportedCurrencies.join(','));
    setTimezone(next.timezone);
    setFiscalYearStartMonth(String(next.fiscalYearStartMonth));
    setStatus(next.status);
    setTaxPolicyStatus(next.taxPolicyStatus); setStatutorySourceStatus(next.statutorySourceStatus); setRevenuePolicyStatus(next.revenuePolicyStatus); setPaymentProviderStatus(next.paymentProviderStatus);
  };

  useEffect(() => {
    void getFinanceFoundation().then(apply).catch((cause) => setError(messageOf(cause))).finally(() => setLoading(false));
  }, []);

  const validate = (): string | null => {
    const normalizedCurrencies = supportedCurrencies.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (!legalName.trim()) return 'Legal entity name is required.';
    if (legalName.trim().length > 200) return 'Legal entity name cannot exceed 200 characters.';
    if (!/^[A-Z]{2}$/.test(countryCode.trim().toUpperCase())) return 'Country code must be exactly 2 letters, for example IN or US.';
    if (!/^[A-Z]{3}$/.test(functionalCurrency.trim().toUpperCase())) return 'Functional currency must be a 3-letter ISO code, for example INR or USD.';
    if (!normalizedCurrencies.length) return 'Enter at least one supported currency.';
    if (normalizedCurrencies.length > 20) return 'You can configure at most 20 supported currencies.';
    if (normalizedCurrencies.some((value) => !/^[A-Z]{3}$/.test(value))) return 'Every supported currency must be a 3-letter ISO code, separated by commas.';
    if (new Set(normalizedCurrencies).size !== normalizedCurrencies.length) return 'Supported currencies must not contain duplicates.';
    if (!normalizedCurrencies.includes(functionalCurrency.trim().toUpperCase())) return 'Supported currencies must include the functional currency.';
    if (!timezone.trim()) return 'Organization timezone is required.';
    const fiscalMonth = Number(fiscalYearStartMonth);
    if (!Number.isInteger(fiscalMonth) || fiscalMonth < 1 || fiscalMonth > 12) return 'Fiscal year start month must be a whole number from 1 to 12.';
    if (reason.trim().length < 3) return 'Reason for change must be at least 3 characters.';
    if (reason.trim().length > 1000) return 'Reason for change cannot exceed 1000 characters.';
    return null;
  };

  const save = async () => {
    if (!data) return;
    const validation = validate();
    if (validation) { setError(validation); setSaved(false); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      const next = await updateFinanceFoundation({
        legalName: legalName.trim(), countryCode: countryCode.trim().toUpperCase(),
        functionalCurrency: functionalCurrency.trim().toUpperCase(),
        supportedCurrencies: supportedCurrencies.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean),
        timezone: timezone.trim(), fiscalYearStartMonth: Number(fiscalYearStartMonth), status,
        expectedVersion: data.version, reason: reason.trim(),
        taxPolicyStatus, statutorySourceStatus, revenuePolicyStatus, paymentProviderStatus,
      });
      apply(next); setReason(''); setSaved(true);
    } catch (cause) { setError(messageOf(cause)); } finally { setSaving(false); }
  };

  if (loading) return <Page title="Finance settings"><Loading /></Page>;
  return (
    <Page title="Finance settings" eyebrow="Finance · Foundation" description="Shared legal entity, currency and fiscal configuration for Finance.">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div />
        <span className="rounded-full border border-app-border px-3 py-1 text-xs font-semibold">Version {data?.version ?? '—'} · {data?.status ?? 'pending_review'}</span>
      </div>
      {error && <Notice error>{error}</Notice>}
      {saved && <Notice>Finance settings saved and audited.</Notice>}
      <Card>
        <div className="grid gap-5 md:grid-cols-2">
          <label className="text-sm font-semibold">Legal entity name<input required minLength={1} maxLength={200} className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={legalName} onChange={(event) => setLegalName(event.target.value)} /></label>
          <label className="text-sm font-semibold">Country code<input required pattern="[A-Za-z]{2}" maxLength={2} className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal uppercase" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} /></label>
          <label className="text-sm font-semibold">Functional currency<input required pattern="[A-Za-z]{3}" maxLength={3} className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal uppercase" value={functionalCurrency} onChange={(event) => setFunctionalCurrency(event.target.value)} /></label>
          <label className="text-sm font-semibold">Supported currencies<input required pattern="[A-Za-z]{3}(\s*,\s*[A-Za-z]{3})*" className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal uppercase" value={supportedCurrencies} onChange={(event) => setSupportedCurrencies(event.target.value)} /><span className="mt-1 block text-xs font-normal text-app-muted">Comma-separated ISO codes, initially INR,AUD.</span></label>
          <label className="text-sm font-semibold">Organization timezone<input required maxLength={80} className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
          <label className="text-sm font-semibold">Fiscal year start month<input required type="number" min={1} max={12} step={1} className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={fiscalYearStartMonth} onChange={(event) => setFiscalYearStartMonth(event.target.value)} /></label>
          <label className="text-sm font-semibold">Configuration status<select className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={status} onChange={(event) => setStatus(event.target.value as FinanceFoundation['status'])}><option value="draft">Draft</option><option value="pending_review">Pending review</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          <label className="text-sm font-semibold">Tax policy status<select className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={taxPolicyStatus} onChange={(event) => setTaxPolicyStatus(event.target.value as FinanceFoundation['taxPolicyStatus'])}><option value="pending_review">Pending review</option><option value="configured">Configured</option></select></label>
          <label className="text-sm font-semibold">Statutory source status<select className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={statutorySourceStatus} onChange={(event) => setStatutorySourceStatus(event.target.value as FinanceFoundation['statutorySourceStatus'])}><option value="pending_review">Pending review</option><option value="configured">Configured</option></select></label>
          <label className="text-sm font-semibold">Revenue policy status<select className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={revenuePolicyStatus} onChange={(event) => setRevenuePolicyStatus(event.target.value as FinanceFoundation['revenuePolicyStatus'])}><option value="pending_review">Pending review</option><option value="configured">Configured</option></select></label>
          <label className="text-sm font-semibold">Payment provider status<select className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={paymentProviderStatus} onChange={(event) => setPaymentProviderStatus(event.target.value as FinanceFoundation['paymentProviderStatus'])}><option value="pending_review">Pending review</option><option value="configured">Configured</option></select></label>
        </div>
        <label className="mt-5 block text-sm font-semibold">Reason for change<textarea className="mt-2 min-h-24 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for every change" /></label>
        <div className="mt-5 flex justify-end"><Button type="button" onClick={() => void save()} disabled={saving || !reason.trim()}>{saving ? 'Saving…' : 'Save settings'}</Button></div>
      </Card>
      <div className="mt-6"><ReconciliationSettingsCard /></div>
      <div className="mt-6"><PaymentGatewaysCard organizationId={organizationId} /></div>
    </Page>
  );
}
