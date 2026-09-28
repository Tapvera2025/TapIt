import { useEffect, useState } from 'react';

interface Run { id: string; periodStart: string; status: string }

export function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    fetch('/api/payroll/runs')
      .then(r => r.json())
      .then((d: { runs: Run[] }) => setRuns(d.runs))
      .catch(console.error);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Payroll Runs</h1>
      <div className="space-y-2">
        {runs.map(r => (
          <div key={r.id} className="bg-white rounded border p-4 flex justify-between">
            <span>{r.periodStart}</span>
            <span className={`text-sm px-2 py-1 rounded ${r.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
          </div>
        ))}
        {runs.length === 0 && <div className="text-gray-500">No payroll runs yet</div>}
      </div>
    </div>
  );
}
