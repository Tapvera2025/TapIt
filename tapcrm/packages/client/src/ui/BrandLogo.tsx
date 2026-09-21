/** Preserve the original artwork; a clipped overlay adapts only the CRM lettering. */
export function BrandLogo({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <span className={`crm-brand ${className}`}>
      <img
        src="/brand/tapvera-crm.png"
        alt="Tapvera CRM"
        width={1981}
        height={793}
        decoding="async"
        draggable={false}
      />
      <img
        className="crm-brand-wordmark"
        src="/brand/tapvera-crm.png"
        alt=""
        aria-hidden="true"
        width={1981}
        height={793}
        decoding="async"
        draggable={false}
      />
    </span>
  );
}
