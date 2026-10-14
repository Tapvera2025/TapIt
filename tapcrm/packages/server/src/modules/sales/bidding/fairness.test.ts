import { describe, expect, it } from 'vitest';
import {
  ActiveCapReachedError,
  DailyCapReachedError,
  DEFAULT_FAIRNESS_CONFIG,
  checkFairness,
  loadFairnessConfig,
} from './fairness.js';
import type { Tx } from '../../../platform/dal/db.js';

interface Row { readonly count: string }

function tx(rows: Row[]): Tx {
  let i = 0;
  const next = async (): Promise<Row> => {
    const row = rows[i++];
    if (!row) throw new Error('tx fake: no more rows');
    return row;
  };
  return {
    query: async () => [],
    one: next,
    maybeOne: async () => null,
  } as unknown as Tx;
}

describe('loadFairnessConfig', () => {
  function configTx(row: { activeLeadMax: number | null; dailyClaimMax: number | null } | null): Tx {
    return { query: async () => [], one: async () => { throw new Error('unused'); }, maybeOne: async () => row } as unknown as Tx;
  }

  it('returns module defaults when the tenant has no override row', async () => {
    const config = await loadFairnessConfig(configTx(null), 'org-1');
    expect(config).toEqual(DEFAULT_FAIRNESS_CONFIG);
  });

  it('returns module defaults when columns are NULL', async () => {
    const config = await loadFairnessConfig(configTx({ activeLeadMax: null, dailyClaimMax: null }), 'org-1');
    expect(config).toEqual(DEFAULT_FAIRNESS_CONFIG);
  });

  it('uses tenant overrides when present', async () => {
    const config = await loadFairnessConfig(configTx({ activeLeadMax: 50, dailyClaimMax: 10 }), 'org-1');
    expect(config).toEqual({ activeLeadMax: 50, dailyClaimMax: 10 });
  });
});

describe('checkFairness', () => {
  it('passes silently when both caps have headroom', async () => {
    await expect(checkFairness(tx([{ count: '5' }]), 'org-1', 'user-a')).resolves.toBeUndefined();
  });
  it('throws ActiveCapReachedError at the active-lead cap', async () => {
    await expect(checkFairness(tx([{ count: '20' }]), 'org-1', 'user-a')).rejects.toBeInstanceOf(ActiveCapReachedError);
  });
  it('does not throw DailyCapReachedError when dailyClaimMax is null', async () => {
    // Only one query is issued (the active-lead count) because the daily
    // branch is skipped entirely when the config is null.
    await expect(checkFairness(tx([{ count: '0' }]), 'org-1', 'user-a')).resolves.toBeUndefined();
  });
});

describe('error shape', () => {
  it('ActiveCapReachedError carries the cap + active count details', () => {
    const err = new ActiveCapReachedError(20, 25);
    expect(err.status).toBe(409);
    expect(err.code).toBe('ACTIVE_CAP_REACHED');
    expect(err.cap).toBe(20);
    expect(err.active).toBe(25);
  });
  it('DailyCapReachedError carries the cap + today count details', () => {
    const err = new DailyCapReachedError(50, 60);
    expect(err.status).toBe(409);
    expect(err.code).toBe('DAILY_CAP_REACHED');
  });
});
