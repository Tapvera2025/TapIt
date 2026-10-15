import { useId } from 'react';
import { Button } from '../../../ui/components.js';
import type { CommercialsItemInput } from './api.js';
import { bpsToPercent, currencySymbol, paiseToRupees, percentToBps, rupeesToPaise } from './proposals-helpers.js';

export interface CommercialsTableProps {
  readonly items: readonly CommercialsItemInput[];
  readonly currency: string;
  readonly readOnly: boolean;
  /** Line totals (bigint paise) returned from the server after the last save. */
  readonly lineTotalsMinor: readonly bigint[];
  readonly onChange: (next: readonly CommercialsItemInput[]) => void;
}

/**
 * Editable line-items table for a commercials draft. The table NEVER
 * computes totals itself — the server does the math on each PATCH. We
 * only render the server's last computed `lineTotalsMinor` alongside
 * each row.
 */
export function CommercialsTable({
  items,
  currency,
  readOnly,
  lineTotalsMinor,
  onChange,
}: CommercialsTableProps): React.JSX.Element {
  const symbol = currencySymbol(currency);

  function patch(index: number, patchItem: Partial<CommercialsItemInput>): void {
    const next = items.map((item, i) => (i === index ? { ...item, ...patchItem } : item));
    onChange(next);
  }

  function removeAt(index: number): void {
    const next = items.filter((_, i) => i !== index).map((item, i) => ({ ...item, sortOrder: i }));
    onChange(next);
  }

  function addRow(): void {
    const next: CommercialsItemInput = {
      serviceName: '',
      quantity: '1',
      unitPriceMinor: 0n,
      itemDiscountMinor: 0n,
      taxCategory: 'standard',
      taxRateBps: 0,
      sortOrder: items.length,
    };
    onChange([...items, next]);
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-app-background text-xs font-semibold uppercase tracking-wide text-app-muted">
            <tr>
              <th className="w-[26%] p-3 text-left">Service</th>
              <th className="w-[10%] p-3 text-right">Qty</th>
              <th className="w-[16%] p-3 text-right">Unit price ({symbol})</th>
              <th className="w-[14%] p-3 text-right">Line discount ({symbol})</th>
              <th className="w-[10%] p-3 text-right">Tax %</th>
              <th className="w-[16%] p-3 text-right">Line total</th>
              {!readOnly && <th className="w-[8%] p-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {items.map((item, index) => (
              <ItemRow
                key={index}
                item={item}
                index={index}
                readOnly={readOnly}
                lineTotalMinor={lineTotalsMinor[index] ?? 0n}
                onPatch={(patchItem) => patch(index, patchItem)}
                onRemove={() => removeAt(index)}
              />
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 6 : 7} className="p-6 text-center text-sm text-app-muted">
                  No line items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="mt-3 flex justify-end">
          <Button kind="secondary" onClick={addRow}>
            Add line item
          </Button>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  index,
  readOnly,
  lineTotalMinor,
  onPatch,
  onRemove,
}: {
  item: CommercialsItemInput;
  index: number;
  readOnly: boolean;
  lineTotalMinor: bigint;
  onPatch: (patch: Partial<CommercialsItemInput>) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const idPrefix = useId();
  // Keep the editable "rupees" string in a derived value — the state of
  // truth for arithmetic is the bigint. If the parsed string doesn't
  // round-trip, we show it unchanged but defer committing.

  const unitPriceStr = paiseToRupees(item.unitPriceMinor);
  const discountStr = paiseToRupees(item.itemDiscountMinor);

  return (
    <tr>
      <td className="p-2">
        <input
          aria-label={`Service name ${index + 1}`}
          disabled={readOnly}
          value={item.serviceName}
          onChange={(event) => onPatch({ serviceName: event.target.value })}
          className="w-full rounded-md border border-app-border bg-app-background px-2 py-1.5 text-sm"
        />
        <input
          aria-label={`Description ${index + 1}`}
          disabled={readOnly}
          placeholder="Description"
          value={item.description ?? ''}
          onChange={(event) => onPatch({ description: event.target.value })}
          className="mt-2 w-full rounded-md border border-app-border bg-app-background px-2 py-1.5 text-xs text-app-muted"
        />
      </td>
      <td className="p-2 text-right">
        <input
          aria-label={`Quantity ${index + 1}`}
          disabled={readOnly}
          value={item.quantity}
          onChange={(event) => onPatch({ quantity: event.target.value })}
          className="w-full rounded-md border border-app-border bg-app-background px-2 py-1.5 text-right text-sm"
        />
      </td>
      <td className="p-2 text-right">
        <MoneyInput
          id={`${idPrefix}-price`}
          value={unitPriceStr}
          disabled={readOnly}
          onChange={(paise) => onPatch({ unitPriceMinor: paise })}
        />
      </td>
      <td className="p-2 text-right">
        <MoneyInput
          id={`${idPrefix}-disc`}
          value={discountStr}
          disabled={readOnly}
          onChange={(paise) => onPatch({ itemDiscountMinor: paise })}
        />
      </td>
      <td className="p-2 text-right">
        <PercentInput
          id={`${idPrefix}-tax`}
          bps={item.taxRateBps}
          disabled={readOnly}
          onChange={(bps) => onPatch({ taxRateBps: bps })}
        />
      </td>
      <td className="p-2 text-right font-semibold">
        {paiseToRupees(lineTotalMinor)}
      </td>
      {!readOnly && (
        <td className="p-2 text-right">
          <button
            type="button"
            aria-label={`Remove line item ${index + 1}`}
            onClick={onRemove}
            className="rounded border border-app-border px-2 py-1 text-xs text-app-danger hover:border-app-danger"
          >
            ✕
          </button>
        </td>
      )}
    </tr>
  );
}

function MoneyInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (paise: bigint) => void;
}): React.JSX.Element {
  return (
    <input
      id={id}
      disabled={disabled}
      defaultValue={value}
      onBlur={(event) => {
        const parsed = rupeesToPaise(event.target.value);
        if (parsed !== null) {
          onChange(parsed);
        } else {
          event.target.value = value;
        }
      }}
      className="w-full rounded-md border border-app-border bg-app-background px-2 py-1.5 text-right text-sm"
    />
  );
}

function PercentInput({
  id,
  bps,
  disabled,
  onChange,
}: {
  id: string;
  bps: number;
  disabled: boolean;
  onChange: (bps: number) => void;
}): React.JSX.Element {
  const current = bpsToPercent(bps);
  return (
    <input
      id={id}
      disabled={disabled}
      defaultValue={current}
      onBlur={(event) => {
        const parsed = percentToBps(event.target.value);
        if (parsed !== null) {
          onChange(parsed);
        } else {
          event.target.value = current;
        }
      }}
      className="w-full rounded-md border border-app-border bg-app-background px-2 py-1.5 text-right text-sm"
    />
  );
}
