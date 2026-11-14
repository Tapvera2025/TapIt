const LEGAL_LINK = 'font-semibold text-app-accent hover:underline';

/**
 * Shown next to "Connect" buttons for Google, YouTube and social accounts: what
 * connecting agrees to, with the links YouTube's and Google's policies require
 * before someone grants access. The policy pages are plain HTML, not app routes,
 * so they open in a new tab.
 */
export function ConnectAgreement({
  youtube,
  className = '',
}: {
  /** Whether YouTube is among the accounts offered, which adds YouTube's terms. */
  youtube: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <p className={`max-w-3xl text-sm text-app-muted ${className}`}>
      By connecting an account, you agree to the Tapvera CRM{' '}
      <a
        href="/privacy#connected-accounts"
        target="_blank"
        rel="noopener noreferrer"
        className={LEGAL_LINK}
      >
        Privacy Policy
      </a>{' '}
      and{' '}
      <a href="/terms" target="_blank" rel="noopener noreferrer" className={LEGAL_LINK}>
        Terms of Service
      </a>
      .
      {youtube && (
        <>
          {' '}
          Tapvera CRM uses YouTube API Services, so connecting YouTube also means you
          agree to the{' '}
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className={LEGAL_LINK}
          >
            YouTube Terms of Service
          </a>
          .
        </>
      )}
    </p>
  );
}
