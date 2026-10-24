import { useEffect, useState } from 'react';
import { Card, ErrorMessage, Loading, Page } from '../../ui/components.js';
import { getPortalProfile, type PortalProfile } from '../api/portalApi.js';

export function ClientProfilePage({ onError }: { onError: (cause: unknown) => void }): React.JSX.Element {
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    getPortalProfile().then((result) => { if (live) setProfile(result); }, (cause: unknown) => { if (live) { setError(cause); onError(cause); } });
    return () => { live = false; };
  }, [onError]);

  if (error) return <Page title="My profile"><ErrorMessage cause={error} /></Page>;
  if (!profile) return <Page title="My profile"><Loading /></Page>;

  const rows: Array<[string, string]> = [
    ['Contact name', profile.clientName],
    ['Business', profile.businessName],
    ['Sign-in email', profile.email],
    ['Region', profile.region.toUpperCase()],
    ['Time zone', profile.timezone],
    ['Managed by', profile.organizationName],
  ];

  return (
    <Page eyebrow="Account" title="My profile" description="To change these details or reset your password, contact your account manager.">
      <Card className="p-4 sm:p-6">
        <h2 className="font-display text-lg font-bold">Account details</h2>
        <dl className="mt-3 grid min-w-0 grid-cols-1 sm:grid-cols-2">
          {rows.map(([label, value], index) => (
            <div
              key={label}
              className={`min-w-0 py-4 ${index < rows.length - 1 ? 'border-b border-app-border/70' : ''} ${index < rows.length - 2 ? 'sm:border-b sm:border-app-border/70' : 'sm:border-b-0'} ${index % 2 === 1 ? 'sm:border-l sm:border-app-border/70 sm:pl-5' : 'sm:pr-5'}`}
            >
              <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-app-muted">{label}</dt>
              <dd className="mt-1.5 break-words text-sm font-medium text-app-foreground sm:text-base">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </Page>
  );
}
