import { describe, expect, it } from 'vitest';
import {
  DEAL_ERROR_CODES,
  DealStateError,
  assertLifecycleTransition,
  assertStageTransition,
  isLegalStageTransition,
} from './state-machine.js';

describe('isLegalStageTransition', () => {
  it('allows the natural forward chain', () => {
    expect(isLegalStageTransition('discovery', 'proposal')).toBe(true);
    expect(isLegalStageTransition('proposal', 'negotiation')).toBe(true);
    expect(isLegalStageTransition('negotiation', 'closing')).toBe(true);
  });
  it('allows backwards transitions among non-closed stages', () => {
    expect(isLegalStageTransition('closing', 'discovery')).toBe(true);
    expect(isLegalStageTransition('proposal', 'discovery')).toBe(true);
  });
  it('allows the same-stage no-op', () => {
    expect(isLegalStageTransition('discovery', 'discovery')).toBe(true);
  });
  it('rejects forward skips of more than one stage', () => {
    expect(isLegalStageTransition('discovery', 'negotiation')).toBe(false);
    expect(isLegalStageTransition('discovery', 'closing')).toBe(false);
  });
  it('rejects any transition into or out of the closed stage', () => {
    expect(isLegalStageTransition('closing', 'closed')).toBe(false);
    expect(isLegalStageTransition('closed', 'discovery')).toBe(false);
  });
});

describe('assertStageTransition', () => {
  it('throws CLOSED_STAGE_RESERVED when a client tries to close via public API', () => {
    expect(() => assertStageTransition('closing', 'closed'))
      .toThrow(expect.objectContaining({
        name: 'DealStateError',
        code: DEAL_ERROR_CODES.CLOSED_STAGE_RESERVED,
      }));
  });
  it('throws INVALID_STAGE_TRANSITION on forward skips', () => {
    try {
      assertStageTransition('discovery', 'closing');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DealStateError);
      expect((err as DealStateError).code).toBe(DEAL_ERROR_CODES.INVALID_STAGE_TRANSITION);
    }
  });
});

describe('assertLifecycleTransition', () => {
  it('allows open → lost and open → cancelled', () => {
    expect(() => assertLifecycleTransition('open', 'lost')).not.toThrow();
    expect(() => assertLifecycleTransition('open', 'cancelled')).not.toThrow();
  });
  it('rejects double-terminal transitions', () => {
    try {
      assertLifecycleTransition('lost', 'cancelled');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DealStateError);
      expect((err as DealStateError).code).toBe(DEAL_ERROR_CODES.ALREADY_TERMINAL);
    }
  });
  it('allows won → cancelled (the explicit cancel-after-win path)', () => {
    expect(() => assertLifecycleTransition('won', 'cancelled')).not.toThrow();
  });
});
