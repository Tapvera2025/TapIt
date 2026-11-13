import { describe, expect, it } from 'vitest';
import { axisLabelEvery, formatDuration, formatPhone, formatTalkTime, outcomeTone, percent, presetRange, shiftDay, timeAgo } from './calls-format.js';

describe('call analytics formatting', () => {
  it('formats durations compactly', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(38)).toBe('38s');
    expect(formatDuration(245)).toBe('4m 05s');
    expect(formatDuration(3720)).toBe('1h 02m');
    expect(formatDuration(null)).toBe('0s');
  });

  it('formats talk time for headline tiles', () => {
    expect(formatTalkTime(1800)).toBe('30 min');
    expect(formatTalkTime(44_640)).toBe('12 h');
    expect(formatTalkTime(5_400)).toBe('1.5 h');
  });

  it('shows rates without dividing by zero', () => {
    expect(percent(3, 4)).toBe('75%');
    expect(percent(1, 0)).toBe('—');
  });

  it('groups phone numbers readably', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone('+14155550123')).toBe('+1 415 555 0123');
    expect(formatPhone('+442079460958')).toBe('+44 20 7946 0958');
    expect(formatPhone('+447911123456')).toBe('+44 7911 123456');
    expect(formatPhone('9876543210')).toBe('9876543210');
    expect(formatPhone(null)).toBe('Unknown number');
  });

  it('computes preset ranges as company calendar days', () => {
    // 20:00 UTC on 31 Oct is 1 Nov in India.
    const now = new Date('2026-10-31T20:00:00Z');
    expect(presetRange('today', 'Asia/Kolkata', now)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(presetRange('7d', 'Asia/Kolkata', now)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(presetRange('month', 'UTC', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('30d', 'UTC', now)).toEqual({ from: '2026-10-02', to: '2026-10-31' });
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('describes how long ago a sync ran', () => {
    const now = new Date('2026-11-04T10:00:00Z');
    expect(timeAgo(null, now)).toBe('never');
    expect(timeAgo('2026-11-04T09:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-11-04T09:45:00Z', now)).toBe('15 min ago');
    expect(timeAgo('2026-11-03T09:00:00Z', now)).toBe('yesterday');
  });

  it('thins axis labels on long ranges and colours outcomes', () => {
    expect(axisLabelEvery(7)).toBe(1);
    expect(axisLabelEvery(30)).toBe(5);
    expect(axisLabelEvery(90)).toBe(14);
    expect(outcomeTone('answered')).toContain('app-success');
    expect(outcomeTone('missed')).toContain('app-danger');
  });
});
