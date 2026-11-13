import { describe, expect, it } from 'vitest';
import { shouldRefreshIdentity } from './useCompanyIdentity.js';

describe('shouldRefreshIdentity', () => {
  it('refreshes when nothing has loaded yet', () => {
    expect(shouldRefreshIdentity(1_000, null, 30_000)).toBe(true);
  });

  it('throttles refreshes inside the minimum interval', () => {
    expect(shouldRefreshIdentity(10_000, 1_000, 30_000)).toBe(false);
    expect(shouldRefreshIdentity(30_999, 1_000, 30_000)).toBe(false);
  });

  it('refreshes once the interval has elapsed', () => {
    expect(shouldRefreshIdentity(31_000, 1_000, 30_000)).toBe(true);
    expect(shouldRefreshIdentity(90_000, 1_000, 30_000)).toBe(true);
  });

  it('refreshes if the clock moved backwards', () => {
    expect(shouldRefreshIdentity(500, 1_000, 30_000)).toBe(true);
  });
});
