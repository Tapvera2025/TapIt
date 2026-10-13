import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  Button,
  Card,
  Empty,
  Loading,
  Notice,
  Page,
  Select,
} from '../../ui/components.js';
import { getCompanyEmployees, type CompanyEmployee } from '../api/companyApi.js';
import { listPenalties } from './api/penaltiesApi.js';
import { downloadPenalties } from './api/penaltiesApi.js';
import { PenaltyForm } from './components/PenaltyForm.js';
import { PenaltyDetailDrawer } from './components/PenaltyDetailDrawer.js';
import { PenaltyCancelModal } from './components/PenaltyCancelModal.js';
import { PenaltyTable } from './components/PenaltyTable.js';
import { PENALTY_LABELS, PENALTY_TYPES, type Penalty } from './types/index.js';

export function PenaltiesPage(): React.JSX.Element {
  const [rows, setRows] = useState<Penalty[]>([]);
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [search, setSearch] = useState('');
  const [penaltyType, setPenaltyType] = useState('');
  const [payrollPeriod, setPayrollPeriod] = useState('');
  const [status, setStatus] = useState('active');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Penalty | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Penalty | null>(null);
  const [exporting, setExporting] = useState(false);

  async function load(): Promise<void> {
    setLoading(true);
    setError('');
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setError('Date From cannot be later than Date To.');
      setLoading(false);
      return;
    }
    try {
      const result = await listPenalties({
        search,
        penaltyType,
        payrollPeriod: payrollPeriod ? `${payrollPeriod}-01` : '',
        status,
        dateFrom,
        dateTo,
        page,
        pageSize: 25,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load penalties.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [search, penaltyType, payrollPeriod, status, dateFrom, dateTo, page]);
  useEffect(() => {
    void getCompanyEmployees()
      .then(setEmployees)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Unable to load employees.'),
      );
  }, []);

  function cancel(row: Penalty): void {
    setSelected(null);
    setCancelTarget(row);
  }

  async function completeCancellation(): Promise<void> {
    setCancelTarget(null);
    setSelected(null);
    await load();
  }

  async function exportReport(format: 'csv' | 'xlsx'): Promise<void> {
    setExporting(true);
    try {
      const blob = await downloadPenalties({ search, penaltyType, payrollPeriod: payrollPeriod ? `${payrollPeriod}-01` : '', status, dateFrom, dateTo }, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `employee-penalties.${format}`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Penalty export downloaded.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to export penalties.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Page
      eyebrow="HR · Advances"
      title="Penalties"
      description="Manage employee penalties and prepare them for future payroll deduction."
      action={<Button onClick={() => setShowForm(true)}>+ Add Penalty</Button>}
    >
      {error && <Notice error>{error}</Notice>}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="text-xs font-semibold text-app-muted xl:col-span-2">
            <span className="mb-2 block">Search employee</span>
            <input
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Name or employee ID"
            />
          </label>
          <Select
            label="Penalty type"
            value={penaltyType}
            onChange={(value) => {
              setPage(1);
              setPenaltyType(value);
            }}
            options={PENALTY_TYPES.map((type) => ({
              value: type,
              label: PENALTY_LABELS[type],
            }))}
          />
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Payroll month</span>
            <input
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground"
              type="month"
              value={payrollPeriod}
              onChange={(event) => {
                setPage(1);
                setPayrollPeriod(event.target.value);
              }}
            />
          </label>
          <Select
            label="Status"
            value={status}
            onChange={(value) => {
              setPage(1);
              setStatus(value);
            }}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'cancelled', label: 'Cancelled' },
              { value: 'all', label: 'All' },
            ]}
          />
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Date from</span>
            <input
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setPage(1);
                setDateFrom(event.target.value);
              }}
            />
          </label>
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Date to</span>
            <input
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setPage(1);
                setDateTo(event.target.value);
              }}
            />
          </label>
        </div>
      </Card>
      <div className="flex flex-wrap justify-end gap-2">
        <Button kind="secondary" onClick={() => void exportReport('csv')} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</Button>
        <Button kind="secondary" onClick={() => void exportReport('xlsx')} disabled={exporting}>Export XLSX</Button>
      </div>
      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-6">
            <Loading />
          </div>
        ) : rows.length === 0 ? (
          <Empty>No penalties match the selected filters.</Empty>
        ) : (
          <PenaltyTable
            rows={rows}
            onSelect={setSelected}
            onCancel={(row) => void cancel(row)}
          />
        )}
        {!loading && total > 25 && (
          <div className="flex items-center justify-between border-t border-app-border px-4 py-3 text-sm text-app-muted">
            <span>{total} penalties</span>
            <div className="flex gap-2">
              <Button
                kind="secondary"
                disabled={page === 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <Button
                kind="secondary"
                disabled={page * 25 >= total}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
      {showForm && (
        <PenaltyForm
          employees={employees}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            toast.success('Penalty recorded.');
            void load();
          }}
        />
      )}
      {selected && (
        <PenaltyDetailDrawer
          penalty={selected}
          onClose={() => setSelected(null)}
          onCancel={() => void cancel(selected)}
        />
      )}
      {cancelTarget && (
        <PenaltyCancelModal
          penalty={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={async () => {
            toast.success('Penalty cancelled.');
            await completeCancellation();
          }}
        />
      )}
    </Page>
  );
}
