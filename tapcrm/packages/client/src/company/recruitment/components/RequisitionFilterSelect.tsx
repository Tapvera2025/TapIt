import type { JobRequisition } from '../types/index.js';

export function RequisitionFilterSelect({ value, onChange, requisitions }: {
  readonly value: string;
  readonly onChange: (requisitionId: string) => void;
  readonly requisitions: readonly JobRequisition[];
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
      aria-label="Filter by requisition"
    >
      <option value="">All Requisitions</option>
      {value && !requisitions.some(({ id }) => id === value) && <option value={value}>Selected requisition</option>}
      {requisitions.map(({ id, requisitionNumber, title }) => (
        <option key={id} value={id}>{requisitionNumber} - {title}</option>
      ))}
    </select>
  );
}
