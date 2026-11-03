import { useEffect, useState } from 'react';
import { Button, Card, Loading, Notice } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import { connectPaymentGateway, disconnectPaymentGateway, getPaymentGateways, type PaymentGateway } from './paymentApi.js';
import { HYPERSWITCH_PROVIDERS } from '@tapcrm/contracts';

const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Unable to update payment gateway.';

export function PaymentGatewaysCard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const [items, setItems] = useState<PaymentGateway[]>([]);
  const [provider, setProvider] = useState<PaymentGateway['provider']>('razorpay');
  const [environment, setEnvironment] = useState<'production' | 'sandbox'>('sandbox');
  const [publicKey, setPublicKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [showSecretKey, setShowSecretKey] = useState(false);
  const selectedProvider = HYPERSWITCH_PROVIDERS.find((item) => item.id === provider) ?? HYPERSWITCH_PROVIDERS[0];
  const webhookUrl = `${window.location.origin}/api/webhooks/payments/hyperswitch/${organizationId}/${provider}`;
  const providerGroups = HYPERSWITCH_PROVIDERS.reduce<Record<string, typeof HYPERSWITCH_PROVIDERS[number][]>>((groups, item) => { (groups[item.region] ??= []).push(item); return groups; }, {});
  const [supportedCurrencies, setSupportedCurrencies] = useState(selectedProvider.defaultCurrencies.join(', '));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = () => getPaymentGateways().then(setItems).catch((cause) => setError(messageOf(cause))).finally(() => setLoading(false));
  useEffect(() => { void load(); }, []);

  const changeProvider = (next: string) => {
    setProvider(next);
    const metadata = HYPERSWITCH_PROVIDERS.find((item) => item.id === next);
    if (metadata) setSupportedCurrencies(metadata.defaultCurrencies.join(', '));
  };
  const connect = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      await connectPaymentGateway({ provider, environment, publicKey: publicKey.trim(), secretKey, supportedCurrencies: supportedCurrencies.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean), reason: reason.trim() });
      setPublicKey(''); setSecretKey(''); setReason(''); setSaved(true); await load();
    } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); }
  };

  const disconnect = async (item: PaymentGateway) => {
    const changeReason = window.prompt('Reason for disconnecting this gateway:');
    if (!changeReason?.trim()) return;
    setBusy(true); setError('');
    try { await disconnectPaymentGateway(item.id, changeReason.trim()); await load(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); }
  };

  return <Card>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Payment gateways</h2><p className="mt-1 text-sm text-app-muted">Connect one provider through the unified Hyperswitch payment orchestration layer.</p></div><span className="rounded-full border border-app-border px-3 py-1 text-xs font-semibold">Credentials are encrypted</span></div>
    {error && <div className="mt-4"><Notice error>{error}</Notice></div>}
    {saved && <div className="mt-4"><Notice>Gateway verified, connected and audited.</Notice></div>}
    {loading ? <div className="mt-5"><Loading /></div> : <>
      {items.filter((item) => item.isActive).map((item) => <div key={item.id} className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border p-4"><div><div className="font-semibold capitalize">{item.provider} · {item.environment}</div><div className="text-sm text-app-muted">{item.publicKey ?? 'Connected provider'} · {item.supportedCurrencies.join(', ')}</div></div><Button type="button" onClick={() => void disconnect(item)} disabled={busy}>Disconnect</Button></div>)}
      <div className="mt-6 grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold">Provider<select className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={provider} onChange={(event) => changeProvider(event.target.value)}>{Object.entries(providerGroups).map(([region, providers]) => <optgroup key={region} label={region}>{providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label><label className="text-sm font-semibold">Mode<select className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={environment} onChange={(event) => setEnvironment(event.target.value as 'production' | 'sandbox')}><option value="sandbox">Sandbox</option><option value="production">Live</option></select></label><label className="text-sm font-semibold">{selectedProvider.keyLabel}<input className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={publicKey} onChange={(event) => setPublicKey(event.target.value)} autoComplete="off" /></label><label className="text-sm font-semibold">{selectedProvider.secretLabel}<span className="relative mt-2 block"><input type={showSecretKey ? 'text' : 'password'} className="w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 pr-12 font-normal" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} autoComplete="new-password" /><button type="button" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg border-0 bg-transparent p-0 text-app-muted hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent" onClick={() => setShowSecretKey((visible) => !visible)} aria-label={showSecretKey ? 'Hide secret key' : 'Show secret key'} aria-pressed={showSecretKey}><Icon name={showSecretKey ? 'eye-off' : 'eye'} className="size-4" /></button></span></label><label className="text-sm font-semibold md:col-span-2">Supported currencies<input className="mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={supportedCurrencies} onChange={(event) => setSupportedCurrencies(event.target.value)} placeholder="INR, USD, EUR" /><span className="mt-1 block text-xs font-normal text-app-muted">Comma-separated ISO-4217 codes.</span></label></div>
      <div className="mt-4 rounded-xl border border-app-border bg-app-surface p-4 text-sm"><div className="font-semibold">Webhook endpoint</div><p className="mt-1 text-app-muted">Paste this Webhook URL into your {selectedProvider.label} dashboard so payments automatically update your CRM.</p><div className="mt-2 break-all rounded-lg border border-app-border bg-app-background px-3 py-2 font-mono text-xs text-app-muted">{webhookUrl}</div><Button type="button" className="mt-3" onClick={() => void navigator.clipboard?.writeText(webhookUrl)}>Copy URL</Button></div>
      <label className="mt-4 block text-sm font-semibold">Reason for change<textarea className="mt-2 min-h-20 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for the audit record" /></label><div className="mt-4 flex justify-end"><Button type="button" onClick={() => void connect()} disabled={busy || !publicKey.trim() || !secretKey || reason.trim().length < 3}>{busy ? 'Connecting…' : 'Verify & connect gateway'}</Button></div>
    </>}
  </Card>;
}
