import { currencySymbol, paiseToRupees } from './proposals-helpers.js';
import './proposal-document.css';

export interface ProposalSender {
  readonly name: string;
  readonly logoDataUrl: string | null;
}

export interface ProposalDocumentData {
  readonly dealTitle: string;
  readonly recipientName: string | null;
  readonly sender: ProposalSender;
  readonly version: number;
  readonly currency: string;
  readonly publishedAt: string | null;
  readonly validityAt: string | null;
  readonly scope: string | null;
  readonly exclusions: string | null;
  readonly timeline: string | null;
  readonly terms: string | null;
  readonly subtotalMinor: string | bigint;
  readonly discountMinor: string | bigint;
  readonly taxMinor: string | bigint;
  readonly totalMinor: string | bigint;
  readonly advanceMinor: string | bigint;
  readonly acceptedAt: string | null;
  readonly items: ReadonlyArray<{
    readonly serviceName: string;
    readonly description: string | null;
    readonly quantity: string;
    readonly lineTotalMinor: string | bigint;
    readonly milestone?: string | null;
  }>;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(value));
}

export function ProposalDocument({ proposal, response }: {
  proposal: ProposalDocumentData;
  response?: React.ReactNode;
}): React.JSX.Element {
  const { sender, recipientName } = proposal;
  const currency = proposal.currency.toUpperCase();
  const money = (value: string | bigint) => `${currencySymbol(currency)}${paiseToRupees(BigInt(value))}`;
  let sectionNumber = 0;

  return (
    <article className="proposal-document">
      <header className="proposal-document-heading">
        <div className="proposal-document-brand">
          {sender.logoDataUrl ? (
            <img src={sender.logoDataUrl} alt={`${sender.name} logo`} />
          ) : (
            <p className="proposal-document-wordmark">{sender.name}</p>
          )}
        </div>
        <div className="proposal-document-meta">
          <p className="proposal-document-kicker">Proposal</p>
          <dl>
            <div><dt>Version</dt><dd>{proposal.version}</dd></div>
            {proposal.publishedAt && <div><dt>Issued</dt><dd>{dateLabel(proposal.publishedAt)}</dd></div>}
            {proposal.validityAt && <div><dt>Valid until</dt><dd>{dateLabel(proposal.validityAt)}</dd></div>}
            <div><dt>Currency</dt><dd>{currency}</dd></div>
          </dl>
        </div>
      </header>

      <div className="proposal-document-parties">
        <div><p>From</p><strong>{sender.name}</strong></div>
        {recipientName && <div><p>Prepared for</p><strong>{recipientName}</strong></div>}
      </div>

      <h1 className="proposal-document-title">{proposal.dealTitle || 'Service proposal'}</h1>

      {proposal.scope?.trim() && (
        <DocumentSection number={++sectionNumber} title="Scope of services">
          <p className="proposal-document-copy">{proposal.scope}</p>
          {proposal.exclusions?.trim() && <><h3>Exclusions</h3><p className="proposal-document-copy">{proposal.exclusions}</p></>}
        </DocumentSection>
      )}
      {!proposal.scope?.trim() && proposal.exclusions?.trim() && (
        <DocumentSection number={++sectionNumber} title="Exclusions"><p className="proposal-document-copy">{proposal.exclusions}</p></DocumentSection>
      )}
      {proposal.timeline?.trim() && (
        <DocumentSection number={++sectionNumber} title="Delivery timeline"><p className="proposal-document-copy">{proposal.timeline}</p></DocumentSection>
      )}

      <DocumentSection number={++sectionNumber} title="Proposed investment">
        <div className="proposal-document-table-wrap" tabIndex={0} role="region" aria-label="Proposal investment table">
          <table className="proposal-document-table">
            <thead>
              <tr><th scope="col">Service &amp; description</th><th scope="col">Qty</th><th scope="col">Amount ({currency})</th></tr>
            </thead>
            <tbody>
              {proposal.items.map((item, index) => (
                <tr key={index}>
                  <th scope="row">
                    <strong>{item.serviceName}</strong>
                    {item.description && <p>{item.description}</p>}
                    {item.milestone && <p><b>Milestone:</b> {item.milestone}</p>}
                  </th>
                  <td>{item.quantity}</td>
                  <td>{money(item.lineTotalMinor)}</td>
                </tr>
              ))}
              {proposal.items.length === 0 && <tr><td colSpan={3}>No services added yet.</td></tr>}
              <tr className="proposal-document-summary"><th scope="row" colSpan={2}>Subtotal</th><td>{money(proposal.subtotalMinor)}</td></tr>
              <tr className="proposal-document-summary"><th scope="row" colSpan={2}>Discount</th><td>{money(proposal.discountMinor)}</td></tr>
              <tr className="proposal-document-summary"><th scope="row" colSpan={2}>Tax</th><td>{money(proposal.taxMinor)}</td></tr>
              <tr className="proposal-document-total"><th scope="row" colSpan={2}>Total investment</th><td>{money(proposal.totalMinor)}</td></tr>
            </tbody>
          </table>
        </div>
      </DocumentSection>

      {BigInt(proposal.advanceMinor) > 0n && (
        <DocumentSection number={++sectionNumber} title="Advance payment">
          <dl className="proposal-document-advance"><dt>Expected advance</dt><dd>{money(proposal.advanceMinor)}</dd></dl>
        </DocumentSection>
      )}
      {proposal.terms?.trim() && (
        <DocumentSection number={++sectionNumber} title="Engagement terms"><p className="proposal-document-copy">{proposal.terms}</p></DocumentSection>
      )}
      {(response || proposal.acceptedAt) && (
        <DocumentSection number={++sectionNumber} title="Acceptance & authorization" interactiveOnly={!proposal.acceptedAt}>
          {proposal.acceptedAt ? (
            <p className="proposal-document-advance">Accepted on {dateLabel(proposal.acceptedAt)}</p>
          ) : response}
        </DocumentSection>
      )}

      <footer className="proposal-document-footer"><span>{sender.name}</span><span>Proposal · Version {proposal.version}</span></footer>
    </article>
  );
}

function DocumentSection({ number, title, children, interactiveOnly = false }: { number: number; title: string; children: React.ReactNode; interactiveOnly?: boolean }): React.JSX.Element {
  return (
    <section className={interactiveOnly ? 'proposal-document-section proposal-document-interactive' : 'proposal-document-section'}>
      <h2>{number}. {title}</h2>
      {children}
    </section>
  );
}
