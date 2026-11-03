import { describe, expect, it } from 'vitest';
import { convertedDealId, leadActivityLabel } from './lead-activity.js';

describe('lead activity lines', () => {
  it('says what a status change did', () => {
    expect(
      leadActivityLabel({
        eventName: 'lead.status_changed',
        metadata: { from: 'callback_scheduled', to: 'follow_up' },
      }),
    ).toBe('Status changed from Callback scheduled to Follow up');
    expect(leadActivityLabel({ eventName: 'lead.status_changed', metadata: {} })).toBe(
      'Status changed',
    );
  });

  it('names the deal a lead became and links to it', () => {
    const converted = {
      eventName: 'lead.converted',
      metadata: { dealId: 'deal-1', dealNumber: '344', title: 'Showroom fit-out' },
    };
    expect(leadActivityLabel(converted)).toBe('Converted to deal #344');
    expect(convertedDealId(converted)).toBe('deal-1');
    expect(
      convertedDealId({ eventName: 'lead.created', metadata: { dealId: 'deal-1' } }),
    ).toBeNull();
  });

  it('gives the loss reason', () => {
    expect(
      leadActivityLabel({
        eventName: 'lead.closed_lost',
        metadata: { lossReason: 'competitor' },
      }),
    ).toBe('Marked as lost: Went with a competitor');
  });

  it('uses plain words for the other events and copes with unknown ones', () => {
    expect(leadActivityLabel({ eventName: 'callback.cancelled' })).toBe(
      'Callback cancelled',
    );
    expect(leadActivityLabel({ eventName: 'lead.reassigned', metadata: null })).toBe(
      'Transferred to a new owner',
    );
    expect(leadActivityLabel({ eventName: 'quote.sent_again' })).toBe('quote sent again');
  });
});
