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

export function PenaltyTable({
  rows,
  onSelect,
  onCancel,
}: {
  rows: Penalty[];
  onSelect: (row: Penalty) => void;
  onCancel: (row: Penalty) => void;
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1050px] text-sm">
        <thead>
          <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
            {[
              'Employee',
              'Department',
              'Team',
              'Position',
              'Penalty type',
              'Amount',
              'Penalty date',
              'Payroll month',
              'Payroll',
              'Status',
              'Actions',
            ].map((label) => (
              <th className="px-4 py-3" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-app-border last:border-0" key={row.id}>
              <td className="px-4 py-3">
                <p className="font-semibold">{row.employeeName}</p>
                <p className="text-xs text-app-muted">{row.employeeCode ?? '—'}</p>
              </td>
              <td className="px-4 py-3">{row.departmentName ?? '—'}</td>
              <td className="px-4 py-3">{row.teamName ?? '—'}</td>
              <td className="px-4 py-3">{row.positionName ?? '—'}</td>
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
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <button
                    className="text-xs font-semibold text-app-accent"
                    onClick={() => onSelect(row)}
                  >
                    View
                  </button>
                  {row.status === 'active' && (
                    <button
                      className="text-xs font-semibold text-app-danger"
                      onClick={() => onCancel(row)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
