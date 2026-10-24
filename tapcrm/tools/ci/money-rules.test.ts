import { describe, expect, it } from 'vitest';
import { findMoneyViolations } from './money-rules.js';

const ROOT = '/repo';

describe('CI-21 — monetary precision classification', () => {
  it('allows unread and pagination counters', () => {
    const text = `
      export interface ChatUnreadSummary {
        total: number;
        direct: number;
        group: number;
        project: number;
      }
    `;
    expect(findMoneyViolations([{ path: `${ROOT}/packages/client/src/chat/api/chatApi.ts`, text }], ROOT)).toEqual({
      violations: [],
      compound: [],
    });
  });

  it('flags direct monetary fields', () => {
    const text = 'interface Invoice { amount: number; }';
    expect(findMoneyViolations([{ path: `${ROOT}/packages/server/src/invoices/types.ts`, text }], ROOT).violations).toEqual([
      { file: 'packages/server/src/invoices/types.ts', line: 1 },
    ]);
  });

  it('flags a contextual invoice total but not a generic count total', () => {
    const invoice = ['interface Invoice {', '  currency: string;', '  total: number;', '}'].join('\n');
    const count = ['interface Page {', '  items: unknown[];', '  total: number;', '}'].join('\n');
    expect(findMoneyViolations([{ path: `${ROOT}/packages/server/src/invoices/types.ts`, text: invoice }], ROOT).violations).toHaveLength(1);
    expect(findMoneyViolations([{ path: `${ROOT}/packages/client/src/api/types.ts`, text: count }], ROOT).violations).toEqual([]);
  });

  it('reports compound monetary names as phased debt', () => {
    const text = 'interface Deal { maxDealValue: number; }';
    expect(findMoneyViolations([{ path: `${ROOT}/packages/server/src/deals/types.ts`, text }], ROOT).compound).toEqual([
      { file: 'packages/server/src/deals/types.ts', line: 1 },
    ]);
  });

  it('does not mistake feedbackRating for a fee field', () => {
    const text = 'interface Interview { feedbackRating: number; }';
    expect(findMoneyViolations([{ path: `${ROOT}/packages/server/src/interviews/types.ts`, text }], ROOT)).toEqual({
      violations: [],
      compound: [],
    });
  });
});

