import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as PublicAddress from '../../../platform/security/public-address.js';

// Response handling only: let the guard pass so a local test server can answer.
// The refusals themselves are covered, unmocked, in guarded-fetch.test.ts.
vi.mock('../../../platform/security/public-address.js', async (original) => {
  const { lookup } = await import('node:dns');
  return {
    ...(await original<typeof PublicAddress>()),
    isPublicAddress: () => true,
    publicOnlyLookup: lookup,
  };
});

const { guardedFetch } = await import('./guarded-fetch.js');

describe('guardedFetch responses', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/gzip') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        res.end(gzipSync('<h1>compressed</h1>'));
      } else if (req.url === '/redirect') {
        res.writeHead(301, { location: '/gzip' });
        res.end();
      } else if (req.url === '/echo' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          res.writeHead(201, { 'content-type': 'application/json', 'x-seen': String(req.headers['x-test']) });
          res.end(JSON.stringify({ body }));
        });
      } else {
        res.writeHead(204);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('returns a standard Response with the body decoded', async () => {
    const response = await guardedFetch(`${base}/gzip`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe('<h1>compressed</h1>');
  });

  it('hands a redirect back to the caller instead of following it', async () => {
    const response = await guardedFetch(`${base}/redirect`);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/gzip');
    await expect(guardedFetch(`${base}/redirect`, { method: 'POST', body: 'x', redirect: 'error' })).rejects.toThrow(/redirect/);
  });

  it('sends a method, headers and a body', async () => {
    const response = await guardedFetch(`${base}/echo`, { method: 'POST', headers: { 'x-test': 'yes' }, body: 'hello' });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-seen')).toBe('yes');
    expect(await response.json()).toEqual({ body: 'hello' });
  });

  it('handles a response with no body', async () => {
    const response = await guardedFetch(`${base}/empty`);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});
