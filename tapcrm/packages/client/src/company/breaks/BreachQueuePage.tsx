import { useEffect, useState } from 'react';
import { listBreaches, type BreachListItem } from '../api/breaksApi.js';

export function BreachQueuePage(): React.JSX.Element {
  const [breaches, setBreaches] = useState<BreachListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void listBreaches({ status: 'pending', limit: 50 })
      .then((items) => setBreaches(items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="p-6 text-app-muted">Loading...</p>;
  if (error) return <p className="p-6 text-red-600">{error}</p>;

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold mb-4">Break Breach Queue</h1>
      {breaches.length === 0 ? (
        <p className="text-sm text-app-muted">No pending breaches.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-app-border text-left text-app-muted">
              <th className="py-2 pr-4">Date</th>
              <th className="py-2 pr-4">Rule</th>
              <th className="py-2 pr-4">Occurrence</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2">Explanation</th>
            </tr>
          </thead>
          <tbody>
            {breaches.map((b) => (
              <tr key={b.id} className="border-b border-app-border">
                <td className="py-2 pr-4">{b.workDate}</td>
                <td className="py-2 pr-4 text-app-muted text-xs">{b.matchedRuleId ?? '—'}</td>
                <td className="py-2 pr-4">{b.occurrenceNumber ?? '—'}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                    b.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                    b.status === 'confirmed' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>{b.status}</span>
                </td>
                <td className="py-2 text-app-muted">{b.explanation ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
