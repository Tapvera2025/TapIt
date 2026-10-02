import { describe, expect, it } from 'vitest';
import type { AttendanceEventInput } from '@tapcrm/contracts';
import type { EligibilityWindow } from '@tapcrm/contracts';
import { closeDecision } from './close.js';

const WIN: EligibilityWindow = { from: '2026-01-10T08:00:00.000Z', to: '2026-01-10T20:00:00.000Z' };
const CAP        = new Date('2026-01-10T20:00:00.000Z');
const SHIFT_END  = new Date('2026-01-10T18:00:00.000Z');
const BEFORE_CAP = new Date('2026-01-10T09:00:00.000Z');
const AFTER_CAP  = new Date('2026-01-10T21:00:00.000Z');

function ev(
  kind: AttendanceEventInput['kind'],
  at: string,
  source: AttendanceEventInput['source'] = 'device',
): AttendanceEventInput {
  const evidence: AttendanceEventInput['evidence'] =
    kind === 'auto-out' || kind === 'scan' ? 'assumed' : 'confirmed';
  return { id: `${kind}-${at}`, kind, at, source, evidence, assignmentReason: 'midpoint' };
}

describe('closeDecision', () => {
  it('real departure: departure event exists → real-departure', () => {
    const events = [ev('in', '2026-01-10T09:00:00.000Z'), ev('out', '2026-01-10T17:00:00.000Z')];
    expect(closeDecision(events, WIN, SHIFT_END, CAP, AFTER_CAP).kind).toBe('real-departure');
  });

  it('still open: now < closingCap', () => {
    const events = [ev('in', '2026-01-10T09:00:00.000Z')];
    expect(closeDecision(events, WIN, SHIFT_END, CAP, BEFORE_CAP).kind).toBe('still-open');
  });

  it('no-show: no events and now >= closingCap', () => {
    expect(closeDecision([], WIN, SHIFT_END, CAP, AFTER_CAP).kind).toBe('no-show');
  });

  it('auto-out: last scan is the last event → basis last-scan', () => {
    // scan at 16:00, nothing later
    const events = [ev('in', '2026-01-10T09:00:00.000Z'), ev('scan', '2026-01-10T16:00:00.000Z')];
    const r = closeDecision(events, WIN, SHIFT_END, CAP, AFTER_CAP);
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.at.toISOString()).toBe('2026-01-10T16:00:00.000Z');
    expect(r.basis).toBe('last-scan');
  });

  it('auto-out: non-scan event is later than last scan → fall through to shift-end', () => {
    // scan at 12:00, break-start at 13:00; actual shift end = 18:00 > 13:00
    const events = [
      ev('in',          '2026-01-10T09:00:00.000Z'),
      ev('scan',        '2026-01-10T12:00:00.000Z'),
      ev('break-start', '2026-01-10T13:00:00.000Z'),
    ];
    const r = closeDecision(events, WIN, SHIFT_END, CAP, AFTER_CAP);
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.at.toISOString()).toBe('2026-01-10T18:00:00.000Z'); // shift end
    expect(r.basis).toBe('shift-end');
  });

  it('auto-out: no window (flexible) → last event wins as last-event', () => {
    const events = [
      ev('in',          '2026-01-10T09:00:00.000Z', 'web'),
      ev('break-start', '2026-01-10T17:30:00.000Z', 'web'),
    ];
    const r = closeDecision(events, null, null, new Date('2026-01-10T23:00:00.000Z'), new Date('2026-01-11T00:00:00.000Z'));
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.at.toISOString()).toBe('2026-01-10T17:30:00.000Z');
    expect(r.basis).toBe('last-event');
  });

  it('no-shift working day past cap with no events → no-show', () => {
    expect(closeDecision([], null, null, CAP, AFTER_CAP).kind).toBe('no-show');
  });

  it('no-shift working day past cap with arrival and no departure → last-event', () => {
    const events = [
      ev('in', '2026-01-10T09:00:00.000Z', 'web'),
      ev('break-start', '2026-01-10T17:30:00.000Z', 'web'),
    ];
    const r = closeDecision(events, null, null, CAP, AFTER_CAP);
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.basis).toBe('last-event');
    expect(r.at.toISOString()).toBe('2026-01-10T17:30:00.000Z');
  });

  it('no-shift working day with a real out → real-departure', () => {
    const events = [
      ev('in', '2026-01-10T09:00:00.000Z', 'web'),
      ev('out', '2026-01-10T17:00:00.000Z', 'web'),
    ];
    expect(closeDecision(events, null, null, CAP, AFTER_CAP).kind).toBe('real-departure');
  });

  it('auto-out: shift-end not later than last event → last-event', () => {
    // The confirmed correction at 19:00 is eligible beyond the 18:00 shift end.
    const events = [
      ev('in',         '2026-01-10T09:00:00.000Z'),
      ev('break-start','2026-01-10T19:00:00.000Z', 'correction'), // correction: always eligible
    ];
    const shortCap = new Date('2026-01-10T21:00:00.000Z');
    const r = closeDecision(events, WIN, SHIFT_END, shortCap, new Date('2026-01-10T22:00:00.000Z'));
    // The correction break-start at 19:00 is the last eligible event; shift-end (18:00) <= 19:00
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.at.toISOString()).toBe('2026-01-10T19:00:00.000Z');
    expect(r.basis).toBe('last-event');
  });

  it('D32 ordering: a same-second break-start follows the scan, so shift-end wins', () => {
    const t = '2026-01-10T16:00:00.000Z';
    const events = [
      ev('in',          '2026-01-10T09:00:00.000Z'),
      ev('scan',        t),
      ev('break-start', t), // same second as scan
    ];
    const r = closeDecision(events, WIN, SHIFT_END, CAP, AFTER_CAP);
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.basis).toBe('shift-end');
    expect(r.at.toISOString()).toBe('2026-01-10T18:00:00.000Z');
  });

  it('correction events always eligible regardless of window', () => {
    const events = [
      ev('in',  '2026-01-10T07:00:00.000Z', 'correction'), // before window.from
      ev('out', '2026-01-10T09:00:00.000Z', 'correction'),
    ];
    expect(closeDecision(events, WIN, SHIFT_END, CAP, AFTER_CAP).kind).toBe('real-departure');
  });
});
