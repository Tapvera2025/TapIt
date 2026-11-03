/**
 * Bright Data AI visibility provider — stub until account is verified.
 * Returns state='not_configured' always; wire real implementation once
 * credentials are available.
 */
import type { SeoProviderResult, SeoProvenance, AIAnswerSnapshot, AISearchProvider } from './types.js';

const PROVENANCE: SeoProvenance = {
  source: 'brightdata',
  retrievedAt: '',
  dataAsOf: null,
  confidence: 'direct',
  isPaid: true,
};

export function createBrightDataProvider(_config: {
  apiKey?: string;
  organizationId: string;
  siteId: string;
  scanRunId: string | null;
}): AISearchProvider {
  return {
    async observe(_args): Promise<SeoProviderResult<AIAnswerSnapshot>> {
      return {
        state: 'not_configured',
        data: null,
        provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
        coverage: null,
        usage: null,
      };
    },
  };
}
