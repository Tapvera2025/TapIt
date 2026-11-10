import { useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import type {
  Dispute,
  PromiseToPay,
  ReceivableAging,
  StatementClient,
} from './receivablesApi.js';

export type ReceivablesAction =
  | 'follow-up'
  | 'dispute'
  | 'promise'
  | 'write-off'
  | 'task'
  | 'resolve-dispute'
  | 'resolve-promise'
  | 'schedule';
type Values = Record<string, string>;
const valueOf = (values: Values, key: string) => values[key] ?? '';

export function ReceivablesActionModal({
  action,
  invoice,
  client,
  item,
  initial,
  onClose,
  onSubmit,
}: {
  action: ReceivablesAction;
  invoice?: ReceivableAging;
  client?: StatementClient;
  item?: Dispute | PromiseToPay;
  initial?: Values;
  onClose: () => void;
  onSubmit: (values: Values) => Promise<void>;
}): React.JSX.Element {
  const [values, setValues] = useState<Values>({
    amount: invoice?.outstandingMinor || '',
    cadenceDays: '7',
    dueAt: localDateTime(),
    promisedFor: localDateTime(),
    nextRunAt: localDateTime(),
    status:
      action === 'resolve-dispute'
        ? 'resolved'
        : action === 'resolve-promise'
          ? 'kept'
          : '',
    taskType: 'call',
    title: invoice ? `Follow up ${invoice.invoiceNumber}` : '',
    ...initial,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const reason = valueOf(values, 'reason').trim();
    if (!reason) return setError('A reason is required.');
    if (
      (action === 'promise' || action === 'write-off') &&
      (!valueOf(values, 'amount') || Number(valueOf(values, 'amount')) <= 0)
    )
      return setError('Enter a valid positive amount.');
    if (
      action === 'schedule' &&
      (!valueOf(values, 'cadenceDays') || Number(valueOf(values, 'cadenceDays')) < 1)
    )
      return setError('Cadence must be at least one day.');
    if (action === 'task' && !valueOf(values, 'title').trim())
      return setError('Enter a task title.');
    setSaving(true);
    setError('');
    try {
      await onSubmit(values);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to save this receivables action.',
      );
    } finally {
      setSaving(false);
    }
  };
  const titles: Record<ReceivablesAction, string> = {
    'follow-up': 'Create collection follow-up',
    dispute: 'Create dispute hold',
    promise: 'Record promise to pay',
    'write-off': 'Propose write-off',
    task: 'Create collection task',
    'resolve-dispute': 'Resolve dispute',
    'resolve-promise': 'Update promise status',
    schedule: 'Schedule client reminders',
  };
  return (
    <Modal title={titles[action]} onClose={onClose} size="md">
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-sm text-app-muted">
          {invoice
            ? `${invoice.invoiceNumber} · ${invoice.currency} ${invoice.outstandingMinor} outstanding`
            : (client?.businessName ??
              (item && 'invoiceNumber' in item ? item.invoiceNumber : ''))}
        </p>
        {error && <Notice error>{error}</Notice>}
        {action === 'follow-up' && (
          <Field
            label="Reason"
            required
            value={valueOf(values, 'reason')}
            onChange={(value) => set('reason', value)}
            placeholder="Explain the collection follow-up"
          />
        )}
        {action === 'dispute' && (
          <>
            <Field
              label="Dispute reason"
              required
              value={valueOf(values, 'reason')}
              onChange={(value) => set('reason', value)}
              placeholder="Explain why the invoice is disputed"
            />
            <Select
              label="Collection hold"
              value={valueOf(values, 'holdCollections') || 'true'}
              onChange={(value) => set('holdCollections', value)}
              options={[
                { value: 'true', label: 'Hold collections' },
                { value: 'false', label: 'Continue collections' },
              ]}
            />
          </>
        )}
        {action === 'promise' && (
          <>
            <Field
              label="Promised amount"
              required
              type="number"
              value={valueOf(values, 'amount')}
              onChange={(value) => set('amount', value)}
            />
            <Field
              label="Promise date and time"
              required
              type="datetime-local"
              value={valueOf(values, 'promisedFor')}
              onChange={(value) => set('promisedFor', value)}
            />
            <Field
              label="Reason"
              required
              value={valueOf(values, 'reason')}
              onChange={(value) => set('reason', value)}
            />
          </>
        )}
        {action === 'write-off' && (
          <>
            <Field
              label="Write-off amount"
              required
              type="number"
              value={valueOf(values, 'amount')}
              onChange={(value) => set('amount', value)}
            />
            <Field
              label="Reason"
              required
              value={valueOf(values, 'reason')}
              onChange={(value) => set('reason', value)}
            />
          </>
        )}
        {action === 'task' && (
          <>
            <Field
              label="Task title"
              required
              value={valueOf(values, 'title')}
              onChange={(value) => set('title', value)}
            />
            <Select
              label="Task type"
              value={valueOf(values, 'taskType') || 'call'}
              onChange={(value) => set('taskType', value)}
              options={[
                { value: 'call', label: 'Call' },
                { value: 'reminder', label: 'Reminder' },
                { value: 'review', label: 'Review' },
                { value: 'promise_follow_up', label: 'Promise follow-up' },
              ]}
            />
            <Field
              label="Due date and time"
              required
              type="datetime-local"
              value={valueOf(values, 'dueAt')}
              onChange={(value) => set('dueAt', value)}
            />
            <Field
              label="Reason"
              required
              value={valueOf(values, 'reason')}
              onChange={(value) => set('reason', value)}
            />
          </>
        )}
        {action === 'resolve-dispute' && (
          <>
            <Select
              label="Status"
              value={valueOf(values, 'status') || 'resolved'}
              onChange={(value) => set('status', value)}
              options={[
                { value: 'resolved', label: 'Resolved' },
                { value: 'rejected', label: 'Rejected' },
                { value: 'under_review', label: 'Under review' },
              ]}
            />
            <Field
              label="Resolution"
              required
              value={valueOf(values, 'resolution')}
              onChange={(value) => set('resolution', value)}
            />
          </>
        )}
        {action === 'resolve-promise' && (
          <>
            <Select
              label="Promise status"
              value={valueOf(values, 'status') || 'kept'}
              onChange={(value) => set('status', value)}
              options={[
                { value: 'kept', label: 'Kept' },
                { value: 'broken', label: 'Broken' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
            <Field
              label="Resolution reason"
              required
              value={valueOf(values, 'reason')}
              onChange={(value) => set('reason', value)}
            />
          </>
        )}
        {action === 'schedule' && (
          <>
            <Field
              label="Cadence in days"
              required
              type="number"
              value={valueOf(values, 'cadenceDays')}
              onChange={(value) => set('cadenceDays', value)}
            />
            <Field
              label="Next reminder"
              required
              type="datetime-local"
              value={valueOf(values, 'nextRunAt')}
              onChange={(value) => set('nextRunAt', value)}
            />
            <Field
              label="Reason"
              required
              value={valueOf(values, 'reason')}
              onChange={(value) => set('reason', value)}
            />
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function localDateTime(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
