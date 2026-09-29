import { useEffect, useState } from 'react';
import { Button, Modal, Notice } from '../../../ui/components.js';
import {
  createApplicationLink,
  listApplicationLinks,
  updateApplicationLinkStatus,
} from '../api/recruitmentApi.js';
import { ApplicationLinkStatusBadge } from './StatusBadge.js';
import type { JobRequisition, RecruitmentApplicationLink } from '../types/index.js';

export function ApplicationLinkModal({
  requisition,
  onClose,
}: {
  readonly requisition: JobRequisition;
  readonly onClose: () => void;
}): React.JSX.Element {
  const [links, setLinks] = useState<RecruitmentApplicationLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  async function loadLinks() {
    setLoading(true);
    try {
      const data = await listApplicationLinks(requisition.id);
      setLinks(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load application links');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLinks();
  }, [requisition.id]);

  const activeOrLatestLink = links[0] ?? null;

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault();
    setActionBusy(true);
    setError(null);
    try {
      const newLink = await createApplicationLink({
        requisitionId: requisition.id,
        expiresAt: expiresAt.trim() ? new Date(expiresAt).toISOString() : undefined,
      });
      setLinks([newLink, ...links]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to generate application link');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleToggleStatus(link: RecruitmentApplicationLink) {
    setActionBusy(true);
    setError(null);
    try {
      const nextStatus = link.status === 'active' ? 'disabled' : 'active';
      const updated = await updateApplicationLinkStatus(link.id, {
        status: nextStatus,
      });
      setLinks((prev) => prev.map((l) => (l.id === link.id ? updated : l)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update link status');
    } finally {
      setActionBusy(false);
    }
  }

  function handleCopy(token: string) {
    const publicUrl = `${window.location.origin}/apply/${token}`;
    void navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function handleOpenForm(token: string) {
    if (activeOrLatestLink?.status !== 'active') return;
    const publicUrl = `${window.location.origin}/apply/${token}`;
    window.open(publicUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <Modal
      title={`Student Application Link — ${requisition.requisitionNumber}`}
      onClose={onClose}
    >
      <div className="space-y-5">
        {error && <Notice error>{error}</Notice>}

        {loading ? (
          <div className="py-8 text-center text-sm text-app-muted">
            Checking application links...
          </div>
        ) : activeOrLatestLink ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-app-border bg-app-surface p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-app-muted">Link Status:</span>
                  <div className="mt-1">
                    <ApplicationLinkStatusBadge status={activeOrLatestLink.status} />
                  </div>
                </div>

                <div className="text-right text-xs text-app-muted">
                  {activeOrLatestLink.expiresAt ? (
                    <div>
                      <span>Expires: </span>
                      <span className="font-semibold text-app-foreground">
                        {new Date(activeOrLatestLink.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                  ) : (
                    <span>No expiration set</span>
                  )}
                </div>
              </div>

              {/* Public URL Box */}
              <div className="mt-4">
                <label className="text-xs font-semibold text-app-muted">
                  Public Application URL
                </label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    value={`${window.location.origin}/apply/${activeOrLatestLink.token}`}
                    className="min-w-0 flex-1 rounded-lg border border-app-border bg-app-background px-3 py-2 font-mono text-xs text-app-foreground outline-none"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      kind="secondary"
                      onClick={() => handleCopy(activeOrLatestLink.token)}
                    >
                      {copied ? 'Copied!' : 'Copy Link'}
                    </Button>
                    <Button
                      kind="secondary"
                      onClick={() => handleOpenForm(activeOrLatestLink.token)}
                      disabled={activeOrLatestLink.status !== 'active'}
                    >
                      Open Form
                    </Button>
                  </div>
                </div>
                {activeOrLatestLink.status !== 'active' && (
                  <p className="mt-1 text-xs text-app-danger">
                    This link is currently {activeOrLatestLink.status}. Applicants will not be able to apply.
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-4">
                <Button
                  kind="secondary"
                  disabled={actionBusy}
                  onClick={() => void handleToggleStatus(activeOrLatestLink)}
                >
                  {activeOrLatestLink.status === 'active' ? 'Disable Link' : 'Enable Link'}
                </Button>

                <p className="text-xs text-app-muted">
                  Created {new Date(activeOrLatestLink.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleCreateLink(e)} className="space-y-4">
            <div className="rounded-xl border border-app-border bg-app-surface p-4 text-sm text-app-muted">
              No student application link exists for this job requisition yet. Generate a unique,
              shareable link to collect resumes from campus drives or career portals.
            </div>

            <label className="block text-xs font-semibold text-app-muted">
              Link Expiration Date (Optional)
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button kind="secondary" onClick={onClose} disabled={actionBusy}>
                Cancel
              </Button>
              <Button kind="primary" type="submit" disabled={actionBusy}>
                {actionBusy ? 'Generating...' : 'Generate Application Link'}
              </Button>
            </div>
          </form>
        )}

        <div className="flex justify-end border-t border-app-border pt-4">
          <Button kind="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
