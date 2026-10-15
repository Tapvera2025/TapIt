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
      <Card>
        <dl className="grid gap-5 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-[0.1em] text-app-muted">{label}</dt>
              <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </Page>
  );
}
