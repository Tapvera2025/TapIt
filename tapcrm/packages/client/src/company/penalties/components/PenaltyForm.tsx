import { useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import type { Decimal } from '@tapcrm/contracts';
import { createPenalty } from '../api/penaltiesApi.js';
import { PENALTY_LABELS, PENALTY_TYPES, type PenaltyType } from '../types/index.js';
import type { CompanyEmployee } from '../../api/companyApi.js';

const today = (): string => new Date().toISOString().slice(0, 10);
const currentMonth = (): string => new Date().toISOString().slice(0, 7);

function amountInPaise(value: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error('Amount must be greater than ₹0.');
  const paise = Math.round(amount * 100);
  if (!Number.isSafeInteger(paise) || paise <= 0)
    throw new Error('Amount is too large or invalid.');
  return paise;
}

export function PenaltyForm({
  employees,
  onClose,
  onCreated,
}: {
  employees: CompanyEmployee[];
  onClose: () => void;
  onCreated: () => void;
}): React.JSX.Element {
  const [employeeId, setEmployeeId] = useState('');
  const [penaltyType, setPenaltyType] = useState<PenaltyType | ''>('');
  const [amount, setAmount] = useState('');
  const [penaltyDate, setPenaltyDate] = useState(today());
  const [payrollPeriod, setPayrollPeriod] = useState(currentMonth());
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(): Promise<void> {
    setError('');
    try {
      if (!employeeId) throw new Error('Employee is required.');
      if (!penaltyType) throw new Error('Penalty type is required.');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payrollPeriod))
        throw new Error('Payroll month is required.');
      if (!penaltyDate) throw new Error('Penalty date is required.');
      const note = remarks.trim();
      if (!note) throw new Error('Remarks are required.');
      setSaving(true);
      await createPenalty({
        employeeId,
        penaltyType,
        amountPaise: String(amountInPaise(amount)) as Decimal,
        penaltyDate,
        payrollPeriod: `${payrollPeriod}-01`,
        remarks: note,
      });
      onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create penalty.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add Penalty"
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : 'Save penalty'}
          </Button>
        </div>
      }
    >
      {error && <Notice error>{error}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Employee"
          value={employeeId}
          onChange={setEmployeeId}
          required
          options={employees.map((employee) => ({
            value: employee.id,
            label: employee.fullName,
          }))}
        />
        <Select
          label="Penalty type"
          value={penaltyType}
          onChange={(value) => setPenaltyType(value as PenaltyType)}
          required
          options={PENALTY_TYPES.map((type) => ({
            value: type,
            label: PENALTY_LABELS[type],
          }))}
        />
        <Field
          label="Amount (₹)"
          type="number"
          value={amount}
          onChange={setAmount}
          required
          placeholder="500"
        />
        <p className="text-xs font-normal text-app-muted sm:col-span-2">
          Payroll month can differ from the penalty date when HR intentionally carries a penalty into a later payroll cycle.
        </p>
        <Field
          label="Penalty date"
          type="date"
          value={penaltyDate}
          onChange={setPenaltyDate}
          required
        />
        <Field
          label="Payroll month"
          type="month"
          value={payrollPeriod}
          onChange={setPayrollPeriod}
          required
        />
        <label className="text-xs font-semibold text-app-muted sm:col-span-2">
          <span className="mb-2 block">Remarks</span>
          <textarea
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            rows={4}
            required
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
            placeholder="Explain the reason for this penalty."
          />
        </label>
      </div>
    </Modal>
  );
}
