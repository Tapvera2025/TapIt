import { useId, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useTheme } from '../theme/ThemeContext.js';
import { formatTrendDay } from './findings-trend-model.js';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

export function SeoTrafficChart({
  daily,
}: {
  daily: { day: string; clicks: number; impressions: number }[];
}) {
  const [metric, setMetric] = useState<'clicks' | 'impressions'>('clicks');
  const { resolvedTheme } = useTheme();
  const id = useId();
  const color = resolvedTheme === 'dark' ? '#94a3b8' : '#64748b';
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => (items[0] ? formatTrendDay(items[0].label, true) : ''),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color,
          maxTicksLimit: 7,
          maxRotation: 0,
          font: { size: 10 },
          callback: (_value, index) =>
            daily[index] ? formatTrendDay(daily[index].day) : '',
        },
      },
      y: {
        beginAtZero: true,
        ticks: { color, precision: 0, font: { size: 10 } },
        grid: { color: resolvedTheme === 'dark' ? '#334155' : '#e2e8f0' },
      },
    },
  };
  return (
    <section className="seo-surface p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="seo-subtitle" id={id}>
            How people find you over time
          </h3>
          <p className="seo-small-copy mt-1">
            Daily totals from your loaded Google report.
          </p>
        </div>
        <div
          role="group"
          aria-label="Traffic chart metric"
          className="flex rounded-lg border border-app-border p-1"
        >
          {(['clicks', 'impressions'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={metric === value}
              onClick={() => setMetric(value)}
              className={`rounded-md px-3 py-1.5 text-xs ${metric === value ? 'bg-app-accent/10 font-semibold text-app-accent' : 'text-app-muted'}`}
            >
              {value === 'clicks' ? 'Visits from Google' : 'Appearances in Google'}
            </button>
          ))}
        </div>
      </div>
      <div className="seo-day-chart">
        <Line
          role="img"
          aria-labelledby={id}
          options={options}
          data={{
            labels: daily.map((row) => row.day),
            datasets: [
              {
                label:
                  metric === 'clicks' ? 'Visits from Google' : 'Appearances in Google',
                data: daily.map((row) => row[metric]),
                borderColor: '#10b981',
                backgroundColor: 'rgba(16,185,129,.10)',
                borderWidth: 2,
                fill: true,
                tension: 0.18,
                pointRadius: daily.length < 3 ? 3 : 0,
                pointHoverRadius: 4,
              },
            ],
          }}
        />
      </div>
      <details className="mt-4 text-xs text-app-muted">
        <summary className="w-fit">View daily numbers</summary>
        <div className="seo-table-wrap mt-3 max-h-64">
          <table className="seo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Visits</th>
                <th>Appearances</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((row) => (
                <tr key={row.day}>
                  <td>{row.day}</td>
                  <td>{row.clicks.toLocaleString()}</td>
                  <td>{row.impressions.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
