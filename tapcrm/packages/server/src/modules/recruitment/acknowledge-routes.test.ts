import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../platform/http/error-handler.js';

/** The joining confirmation link: GET only shows a page, POST confirms. */

interface State { status: 'pending' | 'acknowledged' | 'invalid'; confirmed: string[] }
const state = vi.hoisted((): State => ({ status: 'pending', confirmed: [] }));

vi.mock('./service.js', () => ({
  joiningAcknowledgementState: vi.fn(async () => state.status),
  acknowledgeJoining: vi.fn(async (token: string) => {
    if (state.status === 'invalid') throw new NotFoundError('Invalid or expired token');
    state.confirmed.push(token);
    return { acknowledged: true };
  }),
}));

const { buildPublicRecruitmentRouter } = await import('./public-routes.js');
const TOKEN = 'a'.repeat(64);
let base = '';
let server: ReturnType<express.Express['listen']>;

beforeAll(async () => {
  const app = express();
  app.use('/api/public/recruitment', buildPublicRecruitmentRouter());
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public/recruitment/acknowledge/${TOKEN}`;
});
afterAll(() => new Promise<void>((resolve) => { server.close(() => resolve()); }));

describe('joining confirmation link', () => {
  beforeEach(() => {
    state.status = 'pending';
    state.confirmed = [];
  });

  it('GET shows a confirm button and confirms nothing (mail scanners open links)', async () => {
    const response = await fetch(base);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('<form method="post"><button type="submit">Confirm my joining</button></form>');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.confirmed).toEqual([]);
  });

  it('POST confirms', async () => {
    const response = await fetch(base, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Thank you for confirming your joining');
    expect(state.confirmed).toEqual([TOKEN]);
  });

  it('shows "already confirmed" without a button', async () => {
    state.status = 'acknowledged';
    const html = await (await fetch(base)).text();
    expect(html).toContain('already confirmed');
    expect(html).not.toContain('<form');
  });

  it('shows a readable page for a bad link, on GET and POST', async () => {
    state.status = 'invalid';
    for (const method of ['GET', 'POST']) {
      const response = await fetch(base, { method });
      expect(response.status).toBe(404);
      expect(await response.text()).toContain('This confirmation link is not valid');
    }
  });
});
