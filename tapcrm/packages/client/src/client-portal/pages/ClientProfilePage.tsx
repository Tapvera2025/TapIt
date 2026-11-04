import { useEffect, useState } from 'react';
import { ErrorMessage, Loading, Page, WorkspacePageContainer } from '../../ui/index.js';
import { getPortalProfile, type PortalProfile } from '../api/portalApi.js';
import { ProfileCard } from '../../ui/profile/ProfileComponents.js';

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

  const details = [
    { label: 'Contact name', value: profile.clientName },
    { label: 'Business', value: profile.businessName },
    { label: 'Sign-in email', value: profile.email },
    { label: 'Region', value: profile.region.toUpperCase() },
    { label: 'Time zone', value: profile.timezone },
    { label: 'Managed by', value: profile.organizationName },
  ];

  return (
    <WorkspacePageContainer>
      <ProfileCard
        name={profile.clientName}
        role="Client account"
        details={details}
      />
    </WorkspacePageContainer>
  );
}
