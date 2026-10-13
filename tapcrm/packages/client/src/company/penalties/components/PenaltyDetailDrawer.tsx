import { Button, Modal } from '../../../ui/components.js';
import { PENALTY_LABELS, type Penalty } from '../types/index.js';
import { PayrollStatusBadge, PenaltyStatusBadge } from './PenaltyStatusBadge.js';

const money = (paise: string): string =>
  `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const date = (value: string): string =>
  new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function PenaltyDetailDrawer({
  penalty,
  onClose,
  onCancel,
}: {
  penalty: Penalty;
  onClose: () => void;
  onCancel?: () => void;
}): React.JSX.Element {
  return (
    <Modal
      title="Penalty details"
      onClose={onClose}
      footer={
        <div className="flex justify-between gap-2">
          <Button kind="secondary" onClick={onClose}>
            Close
          </Button>
          {onCancel && penalty.status === 'active' && (
            <Button kind="danger" onClick={onCancel}>
              Cancel penalty
            </Button>
          )}
        </div>
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-app-muted">Employee</dt>
          <dd className="mt-1 font-semibold">{penalty.employeeName}</dd>
        </div>
        <div>
          <dt className="text-xs text-app-muted">Penalty type</dt>
          <dd className="mt-1 font-semibold">{PENALTY_LABELS[penalty.penaltyType]}</dd>
        </div>
        <div>
          <dt className="text-xs text-app-muted">Amount</dt>
          <dd className="mt-1 font-semibold">{money(penalty.amountPaise)}</dd>
        </div>
        <div>
          <dt className="text-xs text-app-muted">Penalty date</dt>
          <dd className="mt-1 font-semibold">{date(penalty.penaltyDate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-app-muted">Payroll month</dt>
          <dd className="mt-1 font-semibold">{date(penalty.payrollPeriod)}</dd>
        </div>
        <div>
          <dt className="text-xs text-app-muted">Status</dt>
          <dd className="mt-1">
            <PenaltyStatusBadge status={penalty.status} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-app-muted">Payroll status</dt>
          <dd className="mt-1">
            <PayrollStatusBadge status={penalty.payrollStatus} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-app-muted">Created date</dt>
          <dd className="mt-1 font-semibold">
            {new Date(penalty.createdAt).toLocaleDateString('en-IN')}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-app-muted">Remarks</dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm">{penalty.remarks}</dd>
        </div>
        {penalty.cancellationReason && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-app-muted">Cancellation reason</dt>
            <dd className="mt-1 text-sm">{penalty.cancellationReason}</dd>
          </div>
        )}
      </dl>
    </Modal>
  );
}
