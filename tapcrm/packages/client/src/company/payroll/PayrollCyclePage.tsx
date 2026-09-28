import { useEffect, useState } from 'react';

interface CycleData {
  currentSlip: { id: string; periodStart: string; status: string; revisionNumber: number } | null;
}

export function PayrollCyclePage() {
  const [data, setData] = useState<CycleData | null>(null);

  useEffect(() => {
    fetch('/api/payroll/cycle')
      .then(r => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  if (!data) return <div>Loading...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Payroll Cycle</h1>
      {data.currentSlip ? (
        <div className="bg-white rounded border p-4">
          <div className="text-sm text-gray-500">Latest published slip</div>
          <div className="font-medium">{data.currentSlip.periodStart}</div>
          <div className="text-sm">Revision {data.currentSlip.revisionNumber}</div>
        </div>
      ) : (
        <div className="text-gray-500">No published payslip yet</div>
      )}
    </div>
  );
}
