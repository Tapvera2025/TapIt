import { describe, expect, it } from 'vitest';
import { createExpenseSchema, expenseListSchema, rejectExpenseSchema } from './validators.js';

const validClaim = {
  expenseDate: '2026-01-15',
  amountPaise: 125050,
  category: 'travel' as const,
  remarks: 'Client visit travel',
};

describe('expense claim validation', () => {
  it('accepts a valid claim and defaults attachments', () => {
    expect(createExpenseSchema.parse(validClaim)).toMatchObject({ ...validClaim, attachments: [] });
  });

  it('rejects invalid amounts, short remarks, and future dates', () => {
    expect(() => createExpenseSchema.parse({ ...validClaim, amountPaise: 0 })).toThrow('Expense amount must be greater than zero.');
    expect(() => createExpenseSchema.parse({ ...validClaim, remarks: 'no' })).toThrow('Remarks must be at least 3 characters.');
    expect(() => createExpenseSchema.parse({ ...validClaim, expenseDate: '2999-01-01' })).toThrow('Expense date cannot be in the future.');
  });

  it('rejects more than three receipts and incomplete rejection reasons', () => {
    const receipt = { originalFilename: 'receipt.pdf', mimeType: 'application/pdf', data: 'JVBERi0=' };
    expect(() => createExpenseSchema.parse({ ...validClaim, attachments: [receipt, receipt, receipt, receipt] })).toThrow('You can upload a maximum of 3 receipts.');
    expect(() => rejectExpenseSchema.parse({ rejectionReason: 'no' })).toThrow('Rejection reason must be at least 3 characters.');
  });

  it('rejects an inverted date range with a clear message', () => {
    expect(() => expenseListSchema.parse({ dateFrom: '2026-02-01', dateTo: '2026-01-01' })).toThrow('Date From cannot be later than Date To.');
  });
});
