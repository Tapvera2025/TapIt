import { describe, expect, it } from 'vitest';
import { isLocalAddress, machineSourceAddress, normaliseIp, sourceAllowed } from './source-address.js';

function req(peer: string, forwarded?: string) {
  return {
    socket: { remoteAddress: peer },
    header: (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? forwarded : undefined),
  } as unknown as Parameters<typeof machineSourceAddress>[0];
}

describe('machine source address', () => {
  it('ignores a forwarded address claimed by a caller who reached the API directly', () => {
    expect(machineSourceAddress(req('203.0.113.9', '192.168.1.50'))).toBe('203.0.113.9');
  });

  it('believes the address the biometric gateway (a local proxy) reports', () => {
    expect(machineSourceAddress(req('172.18.0.7', '192.168.1.50'))).toBe('192.168.1.50');
  });

  it('takes the entry the local proxy added, not one the caller prepended', () => {
    expect(machineSourceAddress(req('::ffff:172.18.0.7', '10.9.9.9, 192.168.1.50'))).toBe('192.168.1.50');
  });

  it('falls back to the peer when a local proxy sends no usable header', () => {
    expect(machineSourceAddress(req('192.168.1.60'))).toBe('192.168.1.60');
    expect(machineSourceAddress(req('172.18.0.7', 'not-an-ip'))).toBe('172.18.0.7');
  });
});

describe('which sources may push', () => {
  it('without an allowlist, accepts the office network and refuses the internet', () => {
    expect(sourceAllowed([], '192.168.1.50')).toBe(true);
    expect(sourceAllowed([], '10.0.4.2')).toBe(true);
    expect(sourceAllowed([], '203.0.113.9')).toBe(false);
    expect(sourceAllowed([], '')).toBe(false);
  });

  it('with an allowlist, accepts exactly the listed addresses', () => {
    expect(sourceAllowed(['192.168.1.50'], '192.168.1.50')).toBe(true);
    expect(sourceAllowed(['192.168.1.50'], '192.168.1.51')).toBe(false);
    expect(sourceAllowed(['198.51.100.7'], '198.51.100.7')).toBe(true);
  });

  it('matches ranges, which the old exact-text comparison never did', () => {
    expect(sourceAllowed(['192.168.1.0/24'], '192.168.1.77')).toBe(true);
    expect(sourceAllowed(['192.168.1.0/24'], '192.168.2.1')).toBe(false);
  });

  it('reads IPv4-mapped IPv6 and rejects junk', () => {
    expect(normaliseIp('::ffff:192.168.1.5')).toBe('192.168.1.5');
    expect(normaliseIp('nonsense')).toBe('');
    expect(isLocalAddress('fd12::1')).toBe(true);
    expect(isLocalAddress('2001:db8::1')).toBe(false);
  });
});
