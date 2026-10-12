import { identityRequest } from '../../../identity/api/authApi.js';
import type { DealLossReason, DealStage } from '../deals/api.js';

export interface FunnelBucket {
  readonly stage: DealStage;
  readonly count: number;
}

export interface LifecycleBucket {
  readonly lifecycleStatus: 'open' | 'won' | 'lost' | 'cancelled';
  readonly count: number;
}

export interface LossReasonBucket {
  readonly reason: DealLossReason;
  readonly count: number;
}

export interface LeaderboardEntry {
  readonly responsibleCloserId: string;
  readonly responsibleCloserName: string | null;
  readonly wonCount: number;
  readonly wonAmountMinor: string;
  readonly currency: string;
}

export interface ForecastReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly funnel: readonly FunnelBucket[];
  readonly lifecycle: readonly LifecycleBucket[];
  readonly lossReasons: readonly LossReasonBucket[];
  readonly winLeaderboard: readonly LeaderboardEntry[];
  readonly totals: {
    readonly wonCount: number;
    readonly wonAmountMinor: string;
    readonly lostCount: number;
    readonly openCount: number;
  };
}

export function getForecast(period?: string): Promise<ForecastReport> {
  const qs = period ? `?period=${encodeURIComponent(period)}` : '';
  return identityRequest(`/api/deals/forecast${qs}`);
}
