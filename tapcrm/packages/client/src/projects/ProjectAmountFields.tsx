import { Field } from '../ui/index.js';
import {
  dueAmount,
  formatProjectAmount,
  projectAmountProblem,
} from './project-amounts.js';

/**
 * Project value and upfront paid, with the due amount worked out as they are
 * typed (project value minus upfront paid). Shared by the create and edit forms.
 */
export function ProjectAmountFields({
  currency,
  projectValue,
  upfrontAmount,
  onProjectValueChange,
  onUpfrontAmountChange,
}: {
  /** The client's currency; null until a client is chosen. */
  currency: string | null;
  projectValue: string;
  upfrontAmount: string;
  onProjectValueChange: (value: string) => void;
  onUpfrontAmountChange: (value: string) => void;
}): React.JSX.Element {
  const suffix = currency ? ` (${currency})` : '';
  const problem = projectAmountProblem(projectValue, upfrontAmount);
  const due = dueAmount(projectValue, upfrontAmount);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field
        label={`Project value${suffix}`}
        type="number"
        min="0"
        value={projectValue}
        onChange={onProjectValueChange}
      />
      <Field
        label={`Upfront paid${suffix}`}
        type="number"
        min="0"
        value={upfrontAmount}
        onChange={onUpfrontAmountChange}
        error={problem ?? undefined}
      />
      <div className="text-xs font-semibold text-app-muted">
        <span className="mb-2 block">Due amount</span>
        <output
          aria-live="polite"
          className="ui-form-control block w-full px-3 py-2.5 text-sm text-app-foreground"
        >
          {due === null ? '—' : currency ? formatProjectAmount(due, currency) : due}
        </output>
        <span className="mt-1 block font-normal">
          Worked out automatically: value − upfront.
        </span>
      </div>
    </div>
  );
}
