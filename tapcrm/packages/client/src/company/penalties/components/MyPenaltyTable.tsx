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

export function MyPenaltyTable({
  rows,
  onSelect,
}: {
  rows: Penalty[];
  onSelect: (row: Penalty) => void;
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
            {[
              'Penalty type',
              'Amount',
              'Penalty date',
              'Payroll month',
              'Payroll status',
              'Status',
              'Remarks',
            ].map((label) => (
              <th className="px-4 py-3" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              className="cursor-pointer border-b border-app-border last:border-0 hover:bg-app-background"
              key={row.id}
              onClick={() => onSelect(row)}
            >
              <td className="px-4 py-3">{PENALTY_LABELS[row.penaltyType]}</td>
              <td className="px-4 py-3">{money(row.amountPaise)}</td>
              <td className="px-4 py-3">{date(row.penaltyDate)}</td>
              <td className="px-4 py-3">{date(row.payrollPeriod)}</td>
              <td className="px-4 py-3">
                <PayrollStatusBadge status={row.payrollStatus} />
              </td>
              <td className="px-4 py-3">
                <PenaltyStatusBadge status={row.status} />
              </td>
              <td className="max-w-xs truncate px-4 py-3">{row.remarks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
