import { describe, expect, it } from 'vitest';
import {
  MetaReconnectRequiredError,
  fetchMetaLead,
  normalizeFieldData,
  type MetaFetchResponse,
  type MetaFetcher,
} from './retrieval.js';

function fakeResponse(status: number, body: unknown): MetaFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

describe('fetchMetaLead', () => {
  it('throws MetaReconnectRequiredError on 401', async () => {
    const fetcher: MetaFetcher = async () => fakeResponse(401, { error: 'invalid_token' });
    await expect(fetchMetaLead(fetcher, 'tok', 'lg-1', 'v18.0')).rejects.toBeInstanceOf(
      MetaReconnectRequiredError,
    );
  });

  it('throws MetaReconnectRequiredError on 403', async () => {
    const fetcher: MetaFetcher = async () => fakeResponse(403, { error: 'perm' });
    await expect(fetchMetaLead(fetcher, 'tok', 'lg-1', 'v18.0')).rejects.toBeInstanceOf(
      MetaReconnectRequiredError,
    );
  });

  it('returns parsed lead data on 200', async () => {
    const fetcher: MetaFetcher = async () =>
      fakeResponse(200, {
        id: 'lg-1',
        created_time: '2024-01-01T00:00:00Z',
        field_data: [{ name: 'full_name', values: ['Rahul'] }],
      });
    const lead = await fetchMetaLead(fetcher, 'tok', 'lg-1', 'v18.0');
    expect(lead.id).toBe('lg-1');
    expect(lead.field_data).toHaveLength(1);
  });
});

describe('normalizeFieldData', () => {
  it('maps the default Meta field names onto IntakeMappedFields', () => {
    const mapped = normalizeFieldData([
      { name: 'full_name', values: ['Rahul Shah'] },
      { name: 'phone_number', values: ['+919876543210'] },
      { name: 'email', values: ['rahul@example.com'] },
      { name: 'city', values: ['Pune'] },
      { name: 'budget', values: ['50k-1L'] },
    ]);
    expect(mapped).toMatchObject({
      contactName: 'Rahul Shah',
      phoneRaw: '+919876543210',
      emailRaw: 'rahul@example.com',
      location: 'Pune',
      budgetBracket: '50k-1L',
    });
  });

  it('honours a connector-level override before the default map', () => {
    const mapped = normalizeFieldData(
      [{ name: 'what_do_you_need', values: ['Website'] }],
      { what_do_you_need: 'serviceRequested' },
    );
    expect(mapped['serviceRequested']).toBe('Website');
  });

  it('preserves unknown field names verbatim', () => {
    const mapped = normalizeFieldData([{ name: 'referral_source', values: ['friend'] }]);
    expect(mapped['referral_source']).toBe('friend');
  });

  it('skips entries with no values', () => {
    const mapped = normalizeFieldData([{ name: 'full_name', values: [] }]);
    expect(mapped['contactName']).toBeUndefined();
  });
});
