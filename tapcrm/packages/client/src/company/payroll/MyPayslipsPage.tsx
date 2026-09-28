import { useEffect, useState } from 'react';

interface Slip { id: string; periodStart: string; revisionNumber: number; grossPaise: string; netPaise: string }

export function MyPayslipsPage() {
  const [slips, setSlips] = useState<Slip[]>([]);

  useEffect(() => {
    fetch('/api/payroll/payslips/mine')
      .then(r => r.json())
      .then((d: { slips: Slip[] }) => setSlips(d.slips))
      .catch(console.error);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">My Payslips</h1>
      <div className="space-y-2">
        {slips.map(s => (
          <div key={s.id} className="bg-white rounded border p-4 flex justify-between">
            <span>{s.periodStart}</span>
            <span className="text-sm text-gray-500">Rev {s.revisionNumber}</span>
          </div>
        ))}
        {slips.length === 0 && <div className="text-gray-500">No payslips published yet</div>}
      </div>
    </div>
  );
}
