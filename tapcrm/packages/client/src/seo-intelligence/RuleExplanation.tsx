import { getSeoRuleCopy } from '@tapcrm/contracts';

export function RuleExplanation({ ruleId }: { ruleId: string }) {
  const copy = getSeoRuleCopy(ruleId);
  return <div>
    <p className="text-base font-semibold text-app-foreground">{copy.title}</p>
    <p className="mt-1 text-sm leading-relaxed text-app-muted">{copy.description}</p>
  </div>;
}

export function RuleReference({ ruleId }: { ruleId: string }) {
  return <details className="mt-3 text-xs text-app-muted">
    <summary className="cursor-pointer">Technical reference</summary>
    <p className="mt-1">Check reference: {ruleId}</p>
  </details>;
}
