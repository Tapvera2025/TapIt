import { describe, expect, it } from 'vitest';
import { describeFailure } from './log.js';

describe('describeFailure', () => {
  it('keeps the error code and the SMTP response code so an admin can see why', () => {
    const error = Object.assign(new Error('Invalid login: 535 Authentication failed'), { code: 'EAUTH', responseCode: 535 });
    expect(describeFailure(error)).toEqual({ code: 'EAUTH', message: 'Invalid login: 535 Authentication failed (SMTP 535)' });
  });

  it('falls back to the error name when there is no code', () => {
    expect(describeFailure(new TypeError('boom')).code).toBe('TypeError');
  });

  it('collapses whitespace and caps the length', () => {
    const { message } = describeFailure(new Error(`line one\n\n   line two ${'x'.repeat(2000)}`));
    expect(message.startsWith('line one line two')).toBe(true);
    expect(message.length).toBeLessThanOrEqual(500);
  });

  it('copes with a thrown non-error', () => {
    expect(describeFailure('nope')).toEqual({ code: 'unknown', message: 'Unknown error' });
  });
});
