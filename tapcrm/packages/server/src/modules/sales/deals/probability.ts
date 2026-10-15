/**
 * Sales v1.1 R2 — deal probability model (R-DEAL-06).
 *
 * Default probability per stage, in integer percentage points. A tenant
 * may override per-deal via the authorized `overrideProbability` path;
 * the override is captured on `deal.probability_override`.
 */

import type { DealStage } from './types.js';

export const DEFAULT_STAGE_PROBABILITY: Readonly<Record<DealStage, number>> = {
  discovery: 20,
  proposal: 40,
  negotiation: 60,
  closing: 85,
  closed: 100,
};

export function effectiveProbability(stage: DealStage, override: number | null): number {
  if (override !== null && override >= 0 && override <= 100) return override;
  return DEFAULT_STAGE_PROBABILITY[stage];
}

export function isValidProbabilityOverride(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}
