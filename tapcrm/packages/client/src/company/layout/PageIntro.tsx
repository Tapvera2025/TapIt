import { useCompanyHeadingTitle, useCompanyPageDescription } from './CompanyNavbarContext.js';

/**
 * A page's own heading block, for narrow screens only. On desktop the top banner
 * already shows the page's title (from the menu) and breadcrumb, so showing this
 * again would put the same heading on the page twice. The description is handed
 * to the banner instead, so the page's real copy is still shown, once.
 */
export function PageIntro({
  eyebrow,
  title,
  description,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
}): React.JSX.Element {
  useCompanyPageDescription(description);
  // The same text as the breadcrumb's last crumb, so a phone never shows two names for one page.
  const heading = useCompanyHeadingTitle() ?? title;
  return (
    <header className="space-y-1 xl:hidden">
      {eyebrow && (
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">{eyebrow}</p>
      )}
      <h1 className="font-display text-2xl font-bold">{heading}</h1>
      <p className="text-sm text-app-muted">{description}</p>
    </header>
  );
}

/** For pages whose own header is too custom to replace: just give the banner the page's description. */
export function BannerDescription({ text }: { readonly text: string }): null {
  useCompanyPageDescription(text);
  return null;
}
