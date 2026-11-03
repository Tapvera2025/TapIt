import { useEffect, useState } from 'react';
import { Button, Modal } from '../ui/components.js';
import { getClients, type Client } from '../clients/api/clientsApi.js';
import { createSeoSite } from './api.js';
import type { SeoSite } from './types.js';
import { Icon } from '../ui/Icon.js';

export function AddSiteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (site: SeoSite) => void;
}) {
  const [url, setUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientNotice, setClientNotice] = useState('Loading optional clients…');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const available: Client[] = [];
        let page = 1;
        let totalPages = 1;
        do {
          const result = await getClients({ status: 'active', page });
          available.push(...result.items);
          totalPages = result.totalPages;
          page++;
        } while (!cancelled && page <= totalPages);
        if (!cancelled) {
          setClients(available);
          setClientNotice(
            available.length ? '' : 'No clients available. You can still add this URL.',
          );
        }
      } catch {
        if (!cancelled)
          setClientNotice(
            'Clients could not be loaded. You can still add this URL without a client.',
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError('');
    try {
      const parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      setError('Enter a complete website URL starting with https:// or http://.');
      return;
    }
    setSaving(true);
    try {
      const site = await createSeoSite({
        displayUrl: url.trim(),
        clientId: clientId || null,
      });
      onCreated(site);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The site could not be added. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    'mt-2 w-full rounded-xl border border-app-border bg-app-background px-3 py-3 text-app-foreground';
  return (
    <Modal
      title="Let’s add your website"
      onClose={() => {
        if (!saving) onClose();
      }}
      dirty={Boolean(url || clientId)}
    >
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        className="space-y-5"
      >
        <div className="flex items-start gap-3 rounded-2xl border border-app-accent/20 bg-app-accent/5 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
            <Icon name="monitor" className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">One website. A clearer picture.</p>
            <p className="mt-1 text-xs leading-6 text-app-muted">
              Add the address you want to check. Once it’s saved, run your first checkup
              to see what needs attention.
            </p>
          </div>
        </div>
        <label className="block text-sm font-medium">
          Website address
          <input
            autoFocus
            required
            type="url"
            maxLength={2048}
            placeholder="https://example.com"
            className={fieldClass}
            value={url}
            disabled={saving}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Which CRM client is this for?{' '}
          <span className="font-normal text-app-muted">(optional)</span>
          <select
            className={fieldClass}
            value={clientId}
            disabled={saving}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value="">Don’t link to a client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.businessName} — {client.clientName}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs leading-6 text-app-muted">
          Use the complete address, such as https://example.com. Client links use your
          CRM’s existing client list.
        </p>
        {clientNotice && <p className="text-xs text-app-muted">{clientNotice}</p>}
        {error && (
          <p role="alert" className="text-sm text-app-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button kind="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !url.trim()}>
            {saving ? 'Saving website…' : 'Add website'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
