import type { SeoSeverity, SeoConfidence } from './types.js';

/**
 * Priority scoring for findings. Severity is the dominant factor; confidence
 * attenuates it; traffic (clicks over the last 28 days from GSC) nudges findings
 * within their severity tier so a high-traffic page's issue outranks a low-traffic
 * one at the same severity+confidence. Range is 0–100 so it fits numeric(5,2).
 */

const SEVERITY_WEIGHT: Record<SeoSeverity, number> = {
  critical: 100,
  high: 70,
  moderate: 40,
  low: 20,
  informational: 5,
};

const CONFIDENCE_MULTIPLIER: Record<SeoConfidence, number> = {
  direct: 1.0,
  corroborated: 0.9,
  inferred: 0.6,
  unknown: 0.3,
};

// Maximum traffic boost multiplier. Chosen so the boost cannot push a finding
// past the base score of the next-higher severity tier (gap between tiers is ≥ 40%).
const MAX_TRAFFIC_BOOST = 0.4;

function trafficBoost(clicks: number): number {
  if (clicks <= 0) return 0;
  // log10(1M) = 6; a page with 1M clicks hits the ceiling. Below that scales smoothly.
  const scaled = (MAX_TRAFFIC_BOOST * Math.log10(1 + clicks)) / 6;
  return Math.min(MAX_TRAFFIC_BOOST, scaled);
}

export function computePriorityScore(
  severity: SeoSeverity,
  confidence: SeoConfidence,
  clicks: number = 0,
): number {
  const base = SEVERITY_WEIGHT[severity] * CONFIDENCE_MULTIPLIER[confidence];
  const score = Math.min(100, base * (1 + trafficBoost(clicks)));
  // Round to 2 decimals for stable DB storage in numeric(5,2)
  return Math.round(score * 100) / 100;
}
