import { describe, expect, it } from 'vitest';
import { formatAge, gateFor, labelForReason } from './triage-helpers.js';

describe('formatAge', () => {
  it('formats seconds under a minute', () => {
    expect(formatAge(45)).toBe('45s');
  });
  it('formats minutes under an hour', () => {
    expect(formatAge(5 * 60)).toBe('5m');
  });
  it('formats hours under a day', () => {
    expect(formatAge(3 * 60 * 60)).toBe('3h');
  });
  it('formats days thereafter', () => {
    expect(formatAge(2 * 24 * 60 * 60)).toBe('2d');
  });
});

describe('labelForReason', () => {
  it('labels known reasons readably', () => {
    expect(labelForReason('bid_pool_timeout_no_fallback')).toBe('No eligible agents after pool timeout');
    expect(labelForReason('review_queue_from_email')).toBe('Email classifier flagged for review');
    expect(labelForReason('no_eligible_agents')).toBe('No eligible agents at intake');
  });
  it('collapses triage_rescue prefixes', () => {
    expect(labelForReason('triage_rescue: HOD override')).toBe('Rescue attempted');
  });
  it('falls back to a title-cased form for unknown reasons', () => {
    expect(labelForReason('weird_unknown_reason')).toBe('weird unknown reason');
  });
  it('handles null as "Needs review"', () => {
    expect(labelForReason(null)).toBe('Needs review');
  });
});

describe('gateFor', () => {
  it('permits all three actions for every role in R1', () => {
    const gate = gateFor('supervisor');
    expect(gate.canRescue).toBe(true);
    expect(gate.canReturnToPool).toBe(true);
    expect(gate.canClose).toBe(true);
  });
});
