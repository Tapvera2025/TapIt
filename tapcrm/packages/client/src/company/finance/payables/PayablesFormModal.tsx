import { useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import type { Bill, PurchaseRequest, ReimbursementClaim, Vendor } from './payablesApi.js';

export type PayablesFormKind =
  | 'vendor'
  | 'bankChange'
  | 'bill'
  | 'subscription'
  | 'purchase'
  | 'reimbursement'
  | 'match';
export interface PayablesFormValues {
  legalName: string;
  displayName: string;
  email: string;
  phone: string;
  gstin: string;
  pan: string;
  currency: string;
  paymentTermsDays: string;
  vendorId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  tdsSection: string;
  tdsRate: string;
  rcm: string;
  bankName: string;
  accountReference: string;
  ifsc: string;
  name: string;
  amount: string;
  recurrence: string;
  nextDueDate: string;
  claimId: string;
  description: string;
  billId: string;
  reason: string;
  artifactFilename: string;
  artifactMimeType: string;
  artifactData: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const money = /^\d+(\.\d{1,2})?$/;
const positiveMoney = (value: string) => money.test(value) && Number(value) > 0;
const minorUnits = (value: string) => Math.round(Number(value) * 100);

export function PayablesFormModal({
  kind,
  vendors,
  bills,
  reimbursementClaims,
  reimbursementClaimsLoading = false,
  reimbursementClaimsError = '',
  request,
  selectedVendorId = '',
  onClose,
  onSubmit,
}: {
  kind: PayablesFormKind;
  vendors: Vendor[];
  bills: Bill[];
  reimbursementClaims: ReimbursementClaim[];
  reimbursementClaimsLoading?: boolean;
  reimbursementClaimsError?: string;
  request?: PurchaseRequest | undefined;
  selectedVendorId?: string;
  onClose: () => void;
  onSubmit: (values: PayablesFormValues) => Promise<void>;
}): React.JSX.Element {
  const [values, setValues] = useState<PayablesFormValues>(() => ({
    legalName: '',
    displayName: '',
    email: '',
    phone: '',
    gstin: '',
    pan: '',
    currency: 'INR',
    paymentTermsDays: '30',
    vendorId: request?.vendorId ?? selectedVendorId,
    bankName: '',
    accountReference: '',
    ifsc: '',
    invoiceNumber: '',
    issueDate: today(),
    dueDate: today(),
    subtotal: '',
    taxTotal: '0',
    total: '',
    tdsSection: '',
    tdsRate: '0',
    rcm: 'false',
    name: '',
    amount: '',
    recurrence: 'monthly',
    nextDueDate: today(),
    claimId: '',
    description: request?.description ?? '',
    billId: '',
    reason: '',
    artifactFilename: '',
    artifactMimeType: '',
    artifactData: '',
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: keyof PayablesFormValues, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const setVendor = (vendorId: string) => {
    const vendor = vendors.find((item) => item.id === vendorId);
    setValues((current) => ({
      ...current,
      vendorId,
      ...(vendor ? { currency: vendor.currency } : {}),
    }));
  };
  const title: Record<PayablesFormKind, string> = {
    vendor: 'Add vendor',
    bankChange: 'Propose vendor bank change',
    bill: 'Add bill to review inbox',
    subscription: 'Add subscription',
    purchase: 'New purchase request',
    reimbursement: 'Import approved expense',
    match: 'Match purchase request to bill',
  };
  const currencyOptions = [
    { value: 'INR', label: 'INR · Indian rupee' },
    { value: 'USD', label: 'USD · US dollar' },
    { value: 'EUR', label: 'EUR · Euro' },
    { value: 'GBP', label: 'GBP · Pound sterling' },
    { value: 'AED', label: 'AED · UAE dirham' },
  ];
  const vendorOptions = vendors
    .filter((item) => item.status === 'active')
    .map((item) => ({ value: item.id, label: `${item.displayName} · ${item.currency}` }));
  const billOptions = bills
    .filter((item) => item.status === 'approved')
    .map((item) => ({
      value: item.id,
      label: `${item.invoiceNumber} · ${item.total} ${item.currency}`,
    }));
  const claimOptions = reimbursementClaims.map((claim) => ({
    value: claim.id,
    label: `${claim.employeeName} · ${claim.amount} ${claim.currency} · ${claim.expenseDate}`,
  }));
  const validate = (): string | null => {
    if (values.reason.trim().length < 3)
      return 'Enter a reason of at least 3 characters. It will be retained in the audit log.';
    if (
      kind === 'vendor' &&
      (values.legalName.trim().length < 2 || values.displayName.trim().length < 2)
    )
      return 'Legal name and display name must contain at least two characters.';
    if (
      kind === 'vendor' &&
      (!/^\d+$/.test(values.paymentTermsDays) || Number(values.paymentTermsDays) > 365)
    )
      return 'Payment terms must be a whole number from 0 to 365 days.';
    if (
      kind === 'bankChange' &&
      (!values.vendorId ||
        values.bankName.trim().length < 2 ||
        values.accountReference.trim().length < 4)
    )
      return 'Select a vendor and enter a bank name and account reference.';
    if (
      kind === 'bill' &&
      (!values.vendorId ||
        !values.invoiceNumber.trim() ||
        !money.test(values.subtotal) ||
        !money.test(values.taxTotal) ||
        !money.test(values.total))
    )
      return 'Select a vendor, enter an invoice number, and provide valid subtotal, tax, and total amounts.';
    if (
      kind === 'bill' &&
      minorUnits(values.total) !==
        minorUnits(values.subtotal) + minorUnits(values.taxTotal)
    )
      return 'Total must equal subtotal plus tax total.';
    if (kind === 'bill' && values.dueDate < values.issueDate)
      return 'Due date cannot precede the issue date.';
    if (
      kind === 'bill' &&
      (!positiveMoney(values.total) ||
        Number(values.tdsRate) < 0 ||
        Number(values.tdsRate) > 100)
    )
      return 'Total must be greater than zero and TDS rate must be between 0 and 100.';
    if (kind === 'bill' && Number(values.tdsRate) > 0 && !values.tdsSection.trim())
      return 'TDS section is required when a TDS rate is entered.';
    if (
      kind === 'subscription' &&
      (!values.vendorId || values.name.trim().length < 2 || !positiveMoney(values.amount))
    )
      return 'Select a vendor and enter a valid subscription name and amount.';
    if (
      kind === 'purchase' &&
      (values.description.trim().length < 3 || !positiveMoney(values.amount))
    )
      return 'Enter a description and a valid requested amount.';
    if (kind === 'reimbursement' && !values.claimId)
      return 'Select an approved expense claim.';
    if (kind === 'match' && !values.billId) return 'Select an approved bill to match.';
    return null;
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit(values);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to save the Payables record.',
      );
    } finally {
      setSaving(false);
    }
  };
  const form = (() => {
    if (kind === 'vendor')
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Legal name"
            required
            value={values.legalName}
            onChange={(v) => set('legalName', v)}
          />
          <Field
            label="Display name"
            required
            value={values.displayName}
            onChange={(v) => set('displayName', v)}
          />
          <Field
            label="Email"
            type="email"
            value={values.email}
            onChange={(v) => set('email', v)}
          />
          <Field label="Phone" value={values.phone} onChange={(v) => set('phone', v)} />
          <Field label="GSTIN" value={values.gstin} onChange={(v) => set('gstin', v)} />
          <Field label="PAN" value={values.pan} onChange={(v) => set('pan', v)} />
          <Select
            label="Currency"
            required
            value={values.currency}
            onChange={(v) => set('currency', v)}
            options={currencyOptions}
          />
          <Field
            label="Payment terms (days)"
            required
            type="number"
            value={values.paymentTermsDays}
            onChange={(v) => set('paymentTermsDays', v)}
          />
        </div>
      );
    if (kind === 'bankChange')
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Vendor"
            required
            value={values.vendorId}
            onChange={setVendor}
            options={vendorOptions}
          />
          <Field
            label="Bank name"
            required
            value={values.bankName}
            onChange={(v) => set('bankName', v)}
          />
          <Field
            label="Account reference"
            required
            value={values.accountReference}
            onChange={(v) => set('accountReference', v)}
            hint="The account reference is masked in the bank-change list."
          />
          <Field
            label="IFSC / routing code"
            value={values.ifsc}
            onChange={(v) => set('ifsc', v)}
          />
        </div>
      );
    if (kind === 'bill')
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Vendor"
            required
            value={values.vendorId}
            onChange={setVendor}
            options={vendorOptions}
          />
          <Field
            label="Invoice number"
            required
            value={values.invoiceNumber}
            onChange={(v) => set('invoiceNumber', v)}
          />
          <Field
            label="Issue date"
            required
            type="date"
            value={values.issueDate}
            onChange={(v) => set('issueDate', v)}
          />
          <Field
            label="Due date"
            required
            type="date"
            value={values.dueDate}
            onChange={(v) => set('dueDate', v)}
          />
          <Field
            label="Subtotal"
            required
            type="number"
            value={values.subtotal}
            onChange={(v) => set('subtotal', v)}
          />
          <Field
            label="Tax total"
            required
            type="number"
            value={values.taxTotal}
            onChange={(v) => set('taxTotal', v)}
          />
          <Field
            label="Total"
            required
            type="number"
            value={values.total}
            onChange={(v) => set('total', v)}
          />
          <Select
            label="Currency"
            required
            disabled={Boolean(values.vendorId)}
            value={values.currency}
            onChange={(v) => set('currency', v)}
            options={currencyOptions}
          />
          <Field
            label="TDS section"
            value={values.tdsSection}
            onChange={(v) => set('tdsSection', v)}
          />
          <Field
            label="TDS rate (%)"
            type="number"
            value={values.tdsRate}
            onChange={(v) => set('tdsRate', v)}
          />
          <Select
            label="Reverse charge"
            value={values.rcm}
            onChange={(v) => set('rcm', v)}
            options={[
              { value: 'false', label: 'No' },
              { value: 'true', label: 'Yes' },
            ]}
          />
          <div>
            <label className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Invoice document</span>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 10 * 1024 * 1024) {
                    setError('Invoice document must be smaller than 10 MB.');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = typeof reader.result === 'string' ? reader.result : '';
                    setValues((current) => ({
                      ...current,
                      artifactFilename: file.name,
                      artifactMimeType: file.type,
                      artifactData: result.split(',')[1] ?? '',
                    }));
                  };
                  reader.readAsDataURL(file);
                }}
                className="block w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
              />
            </label>
            <p className="mt-1 text-xs text-app-muted">
              PDF, PNG, or JPEG. Stored by the backend.
            </p>
          </div>
        </div>
      );
    if (kind === 'subscription')
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Vendor"
            required
            value={values.vendorId}
            onChange={setVendor}
            options={vendorOptions}
          />
          <Field
            label="Subscription name"
            required
            value={values.name}
            onChange={(v) => set('name', v)}
          />
          <Field
            label="Recurring amount"
            required
            type="number"
            value={values.amount}
            onChange={(v) => set('amount', v)}
          />
          <Select
            label="Currency"
            required
            disabled={Boolean(values.vendorId)}
            value={values.currency}
            onChange={(v) => set('currency', v)}
            options={currencyOptions}
          />
          <Select
            label="Recurrence"
            value={values.recurrence}
            onChange={(v) => set('recurrence', v)}
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'quarterly', label: 'Quarterly' },
              { value: 'annual', label: 'Annual' },
            ]}
          />
          <Field
            label="Next due date"
            required
            type="date"
            value={values.nextDueDate}
            onChange={(v) => set('nextDueDate', v)}
          />
        </div>
      );
    if (kind === 'purchase')
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Vendor (optional)"
            value={values.vendorId}
            onChange={setVendor}
            options={vendorOptions}
          />
          <Field
            label="Description"
            required
            value={values.description}
            onChange={(v) => set('description', v)}
          />
          <Field
            label="Requested amount"
            required
            type="number"
            value={values.amount}
            onChange={(v) => set('amount', v)}
          />
          <Select
            label="Currency"
            required
            value={values.currency}
            onChange={(v) => set('currency', v)}
            options={currencyOptions}
          />
        </div>
      );
    if (kind === 'reimbursement')
      return (
        <div>
          {reimbursementClaimsError && <Notice error>{reimbursementClaimsError}</Notice>}
          <Select
            label={
              reimbursementClaimsLoading
                ? 'Approved expense claim (loading…)'
                : 'Approved expense claim'
            }
            required
            disabled={reimbursementClaimsLoading}
            value={values.claimId}
            onChange={(v) => set('claimId', v)}
            options={claimOptions}
          />
          <p className="mt-2 text-xs text-app-muted">
            Only approved claims that have not already become a payable are available.
          </p>
        </div>
      );
    return (
      <div>
        <Select
          label="Approved bill"
          required
          value={values.billId}
          onChange={(v) => set('billId', v)}
          options={billOptions}
        />
        <p className="mt-2 text-xs text-app-muted">
          Only approved bills are available for matching.
        </p>
      </div>
    );
  })();
  return (
    <Modal
      title={title[kind]}
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payables-form" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <form
        id="payables-form"
        onSubmit={(event) => void submit(event)}
        className="space-y-5"
      >
        {error && <Notice error>{error}</Notice>}
        {form}
        <Field
          label="Reason"
          required
          value={values.reason}
          onChange={(v) => set('reason', v)}
          hint="This reason is retained in the Payables audit log."
        />
      </form>
    </Modal>
  );
}

export function PayablesReasonModal({
  title,
  description,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError(
        'Enter a reason of at least 3 characters. This will be retained in the audit log.',
      );
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit(reason.trim());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to complete this Payables action.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payables-reason-form" disabled={saving}>
            {saving ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      }
    >
      <form
        id="payables-reason-form"
        onSubmit={(event) => void submit(event)}
        className="space-y-4"
      >
        {error && <Notice error>{error}</Notice>}
        <p className="text-sm text-app-muted">{description}</p>
        <Field
          label="Reason"
          required
          value={reason}
          onChange={setReason}
          placeholder="Explain why this action is being taken"
          hint="The server records this reason with the action audit event."
        />
      </form>
    </Modal>
  );
}
