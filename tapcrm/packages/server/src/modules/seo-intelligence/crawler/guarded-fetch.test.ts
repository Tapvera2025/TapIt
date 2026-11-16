import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardedFetch } from './guarded-fetch.js';
import { SsrfBlockedError } from './ssrf-errors.js';
import { isPublicAddress } from '../../../platform/security/public-address.js';

describe('which addresses count as public', () => {
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
  it.each([
    '0.0.0.0', '127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '[::1]', 'not-an-ip',
  ])('%s is not public (including the ranges the old guard missed)', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe('guardedFetch refuses non-public targets before sending anything', () => {
  let server: Server;
  let port = 0;
  let hits = 0;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits += 1;
      res.end('internal');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('refuses an IP literal on this machine', async () => {
    await expect(guardedFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(guardedFetch(`http://[::ffff:127.0.0.1]:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(guardedFetch(`http://0.0.0.0:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('refuses a name that resolves to this machine (checked at connection time)', async () => {
    await expect(guardedFetch(`http://localhost:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('never reached the local server', () => {
    expect(hits).toBe(0);
  });

  it('refuses other schemes', async () => {
    await expect(guardedFetch('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

