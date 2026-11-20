import { useEffect, useState } from 'react';
import { organizationApi } from '../../organization/api/organizationApi.js';
import { Button, Card, Icon } from '../../ui/index.js';

const MAX_LOGO_BYTES = 512 * 1024;

export function ProposalBrandingSettings(): React.JSX.Element {
  const [branding, setBranding] = useState<Awaited<ReturnType<typeof organizationApi.proposalBranding>> | null>(null);
  const [pendingLogo, setPendingLogo] = useState<string | null | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    organizationApi.proposalBranding().then((result) => {
      if (active) setBranding(result);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load proposal branding.');
    });
    return () => { active = false; };
  }, []);

  function selectLogo(file: File | undefined): void {
    if (!file) return;
    setError('');
    setStatus('');
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > MAX_LOGO_BYTES) {
      setError('Choose a PNG or JPEG image up to 512 KB.');
      return;
    }
    setReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPendingLogo(reader.result);
      setReading(false);
    };
    reader.onerror = () => {
      setError('This image could not be read.');
      setReading(false);
    };
    reader.readAsDataURL(file);
  }

  async function save(): Promise<void> {
    if (pendingLogo === undefined || reading || saving) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const result = await organizationApi.updateProposalBranding({ logoDataUrl: pendingLogo });
      setBranding(result);
      setPendingLogo(undefined);
      setStatus('Proposal branding saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save proposal branding.');
    } finally {
      setSaving(false);
    }
  }

  const logo = pendingLogo === undefined ? branding?.logoDataUrl : pendingLogo;

  return (
    <Card>
      <h2 className="font-display text-xl font-bold">Sales proposal branding</h2>
      <p className="mt-1 text-sm text-app-muted">Your company name and logo appear on proposals shared with clients.</p>
      {branding ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-app-border bg-app-surface-raised p-3">
            <div className="grid h-14 min-w-20 place-items-center rounded-lg bg-white px-2">
              {logo ? <img src={logo} alt="Proposal logo preview" className="max-h-11 max-w-28 object-contain" /> : <Icon name="building" className="size-5 text-slate-600" />}
            </div>
            <div className="min-w-0">
              <p className="break-words font-semibold">{branding.name}</p>
              <p className="text-xs text-app-muted">{logo ? 'Proposal sender' : 'Proposals will show the company name.'}</p>
            </div>
          </div>
          <label className="block text-sm font-semibold">
            Company logo
            <input
              type="file"
              accept="image/png,image/jpeg"
              disabled={saving || reading}
              className="mt-1 block w-full min-w-0 rounded-lg border border-app-border p-2 text-sm"
              onChange={(event) => {
                selectLogo(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <p className="text-xs text-app-muted">PNG or JPEG, up to 512 KB.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pendingLogo === undefined || reading || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save branding'}</Button>
            {logo && <Button kind="secondary" disabled={saving || reading} onClick={() => { setPendingLogo(branding.logoDataUrl ? null : undefined); setStatus(''); }}>Remove logo</Button>}
          </div>
        </div>
      ) : !error && <p role="status" className="mt-3 text-sm text-app-muted">Loading branding…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-app-danger">{error}</p>}
      {status && <p role="status" className="mt-3 text-sm text-app-muted">{status}</p>}
    </Card>
  );
}
