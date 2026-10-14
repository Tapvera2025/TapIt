import { describe, expect, it } from 'vitest';
import {
  fetchesMissingFromSubmissions,
  listRecentLeadsForPage,
  type GraphLeadDiscovery,
} from './reconcile.js';
import type { MetaFetchResponse, MetaFetcher } from './retrieval.js';

function fakeResponse(status: number, body: unknown): MetaFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

describe('fetchesMissingFromSubmissions', () => {
  it('returns only ids not already present in the existing-keys set', () => {
    const discovered: GraphLeadDiscovery[] = [
      { leadgenId: 'lg-1', formId: 'f', createdTime: null },
      { leadgenId: 'lg-2', formId: 'f', createdTime: null },
      { leadgenId: 'lg-3', formId: 'f', createdTime: null },
      { leadgenId: 'lg-4', formId: 'f', createdTime: null },
      { leadgenId: 'lg-5', formId: 'f', createdTime: null },
    ];
    const existing = new Set(['lg-1', 'lg-3', 'lg-5']);
    const missing = fetchesMissingFromSubmissions(discovered, existing);
    expect(missing.map((m) => m.leadgenId)).toEqual(['lg-2', 'lg-4']);
  });

  it('dedupes repeated discoveries of the same id', () => {
    const discovered: GraphLeadDiscovery[] = [
      { leadgenId: 'lg-1', formId: 'f', createdTime: null },
      { leadgenId: 'lg-1', formId: 'f', createdTime: null },
      { leadgenId: 'lg-2', formId: 'f', createdTime: null },
    ];
    const missing = fetchesMissingFromSubmissions(discovered, new Set());
    expect(missing.map((m) => m.leadgenId)).toEqual(['lg-1', 'lg-2']);
  });
});

describe('listRecentLeadsForPage', () => {
  it('flattens form.leads.data[] into GraphLeadDiscovery[]', async () => {
    const fetcher: MetaFetcher = async () =>
      fakeResponse(200, {
        data: [
          { id: 'form-1', leads: { data: [{ id: 'lg-1', created_time: 't1' }, { id: 'lg-2' }] } },
          { id: 'form-2', leads: { data: [{ id: 'lg-3' }] } },
        ],
      });
    const discoveries = await listRecentLeadsForPage(fetcher, 'tok', 'page-1', 'v18.0');
    expect(discoveries).toHaveLength(3);
    expect(discoveries[0]).toMatchObject({ leadgenId: 'lg-1', formId: 'form-1', createdTime: 't1' });
    expect(discoveries[2]).toMatchObject({ leadgenId: 'lg-3', formId: 'form-2' });
  });

  it('returns [] when the Graph call fails', async () => {
    const fetcher: MetaFetcher = async () => fakeResponse(500, 'boom');
    expect(await listRecentLeadsForPage(fetcher, 'tok', 'page-1', 'v18.0')).toEqual([]);
  });
});
