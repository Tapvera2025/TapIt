import { describe, expect, it } from 'vitest';
import { isLocalRequest, type RequestOrigin } from './local-request.js';

const request = (remoteAddress: string, extra: Partial<RequestOrigin> = {}): RequestOrigin => ({
  remoteAddress,
  forwardedFor: undefined,
  origin: undefined,
  ...extra,
});

describe('requests from the developer’s own machine', () => {
  describe('API running on the computer (npm run dev:api)', () => {
    it.each([
      ['the Vite dev server', request('127.0.0.1', { origin: 'http://localhost:5173' })],
      ['an IPv4-mapped loopback peer', request('::ffff:127.0.0.1')],
      ['IPv6 localhost', request('::1', { origin: 'http://[::1]:5173' })],
      ['a 127.0.0.1 page', request('127.0.0.1', { origin: 'http://127.0.0.1:5173' })],
      ['a *.localhost page', request('127.0.0.1', { origin: 'http://tapcrm.localhost:5173' })],
      ['a local proxy naming this machine', request('127.0.0.1', { forwardedFor: '127.0.0.1' })],
    ])('accepts %s', (_label, input) => {
      expect(isLocalRequest(input, false)).toBe(true);
    });

    it.each([
      ['another computer on the network', request('192.168.1.40')],
      ['a Docker network address when the API is not in a container', request('172.18.0.5', { origin: 'http://localhost:5173' })],
      ['a proxy naming another computer', request('127.0.0.1', { forwardedFor: '127.0.0.1, 192.168.1.40' })],
      ['a repeated forwarded header naming another computer', request('127.0.0.1', { forwardedFor: ['127.0.0.1', '10.0.0.8'] })],
      ['a page opened from another device through the dev server', request('127.0.0.1', { origin: 'http://192.168.1.10:5173' })],
      ['an opaque origin', request('::1', { origin: 'null' })],
      ['a page on a look-alike host', request('127.0.0.1', { origin: 'http://localhost.example.com:5173' })],
      ['an unknown peer', request('')],
    ])('refuses %s', (_label, input) => {
      expect(isLocalRequest(input, false)).toBe(false);
    });
  });

  describe('API running in Docker Compose', () => {
    it.each([
      ['the web container forwarding a localhost page', request('172.18.0.6', { origin: 'http://localhost:5173' })],
      ['Docker Desktop forwarding a published port', request('192.168.65.1')],
      ['an IPv4-mapped Docker address', request('::ffff:10.89.0.4', { origin: 'http://127.0.0.1:5173' })],
    ])('accepts %s', (_label, input) => {
      expect(isLocalRequest(input, true)).toBe(true);
    });

    it.each([
      ['a public address', request('203.0.113.9', { origin: 'http://localhost:5173' })],
      ['a VPN (CGNAT) address', request('100.101.102.103')],
      ['a page opened from another device', request('172.18.0.6', { origin: 'http://192.168.1.10:5173' })],
    ])('refuses %s', (_label, input) => {
      expect(isLocalRequest(input, true)).toBe(false);
    });
  });
});
