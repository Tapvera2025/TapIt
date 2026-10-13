import { describe, expect, it } from 'vitest';
import {
  bpsToPercent,
  commercialsStateTone,
  isDraftEditable,
  paiseToRupees,
  percentToBps,
  rupeesToPaise,
} from './proposals-helpers.js';

describe('rupeesToPaise', () => {
  it('accepts integer rupees', () => {
    expect(rupeesToPaise('1234')).toBe(123_400n);
  });
  it('accepts one and two decimal places', () => {
    expect(rupeesToPaise('12.3')).toBe(1_230n);
    expect(rupeesToPaise('0.07')).toBe(7n);
  });
  it('rejects malformed input', () => {
    expect(rupeesToPaise('')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
    expect(rupeesToPaise('-10')).toBeNull();
    expect(rupeesToPaise('1.234')).toBeNull();
  });
});

describe('paiseToRupees', () => {
  it('formats with two decimals and thousands separators', () => {
    expect(paiseToRupees(0n)).toBe('0.00');
    expect(paiseToRupees(5n)).toBe('0.05');
    expect(paiseToRupees(12345678n)).toBe('123,456.78');
  });
  it('handles negative amounts', () => {
    expect(paiseToRupees(-199n)).toBe('-1.99');
  });
});

describe('bps conversions', () => {
  it('round-trips simple values', () => {
    expect(percentToBps('18')).toBe(1_800);
    expect(bpsToPercent(1_800)).toBe('18.00');
    expect(bpsToPercent(1_850)).toBe('18.50');
    expect(percentToBps('18.5')).toBe(1_850);
  });
  it('rejects >100% and malformed', () => {
    expect(percentToBps('101')).toBeNull();
    expect(percentToBps('x')).toBeNull();
    expect(percentToBps('')).toBeNull();
  });
});

describe('commercialsStateTone + isDraftEditable', () => {
  it('maps states to tones', () => {
    expect(commercialsStateTone('draft')).toBe('warning');
    expect(commercialsStateTone('published')).toBe('info');
    expect(commercialsStateTone('accepted')).toBe('success');
    expect(commercialsStateTone('rejected')).toBe('danger');
  });
  it('only draft is editable', () => {
    expect(isDraftEditable('draft')).toBe(true);
    expect(isDraftEditable('published')).toBe(false);
    expect(isDraftEditable('accepted')).toBe(false);
  });
});
