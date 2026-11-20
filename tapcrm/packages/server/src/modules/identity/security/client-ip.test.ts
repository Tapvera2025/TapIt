import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Production path: browser -> Cloudflare -> cloudflared -> client nginx -> API.
 * Cloudflare writes the real client address into X-Forwarded-For and nginx appends the
 * address it saw (cloudflared's container). Express counts TRUST_PROXY_HOPS from the right.
 */
const REAL_CLIENT = '203.0.113.77';
const CLOUDFLARED = '172.20.0.9';

let server: Server | null = null;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

async function seenAddress(hops: number, forwardedFor: string): Promise<string> {
  const app = express();
  app.set('trust proxy', hops);
  app.get('/ip', (req, res) => res.send(req.ip ?? ''));
  server = createServer(app);
  await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', ready));
  const { port } = server.address() as AddressInfo;
  return new Promise<string>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/ip', headers: { 'x-forwarded-for': forwardedFor } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += String(chunk)));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('client address behind the Cloudflare Tunnel', () => {
  const chain = `${REAL_CLIENT}, ${CLOUDFLARED}`; // what nginx hands the API

  it('with 1 hop every visitor looks like cloudflared (the bug: one shared lockout)', async () => {
    expect(await seenAddress(1, chain)).toBe(CLOUDFLARED);
  });

  it('with 2 hops the real client address is used', async () => {
    expect(await seenAddress(2, chain)).toBe(REAL_CLIENT);
  });

  it('a client cannot pick its own address by sending a forged X-Forwarded-For', async () => {
    // Cloudflare appends the real peer to whatever the client sent.
    const forged = `1.1.1.1, ${REAL_CLIENT}, ${CLOUDFLARED}`;
    expect(await seenAddress(2, forged)).toBe(REAL_CLIENT);
  });
});
