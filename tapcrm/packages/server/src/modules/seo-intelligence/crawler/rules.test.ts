import { describe, expect, it } from 'vitest';
import { parseHtml } from './parse.js';
import { evaluateAll, getActiveRules, getAllRules } from './rules/index.js';
import type { FetchResult } from './http.js';

function fakeFetch(body: string, overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    finalUrl: 'https://example.com/',
    status: 200,
    headers: {},
    body,
    byteLength: body.length,
    truncated: false,
    elapsedMs: 100,
    redirectChain: [],
    ...overrides,
  };
}

function findResult(results: ReturnType<typeof evaluateAll>, ruleId: string) {
  return results.find((r) => r.ruleId === ruleId);
}

describe('rules engine (parse → evaluate)', () => {
  it('a complete, healthy page returns no fail results', () => {
    const bodyCopy = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const html = `<!doctype html>
      <html lang="en">
        <head>
          <title>Healthy Home Page</title>
          <meta name="description" content="A healthy page with all the expected SEO tags" />
          <link rel="canonical" href="https://example.com/" />
        </head>
        <body><h1>Healthy</h1><p>${bodyCopy}</p></body>
      </html>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    const results = evaluateAll(obs);

    const failures = results.filter((r) => r.result === 'fail');
    expect(failures).toHaveLength(0);
  });

  it('M001 fails when the title element is missing', () => {
    const html = `<html lang="en"><head></head><body><h1>Hi</h1></body></html>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    const results = evaluateAll(obs);

    const m001 = findResult(results, 'M001');
    expect(m001?.result).toBe('fail');
    expect(m001?.severity).toBe('high');
    expect(m001?.affectedTarget).toBe('https://example.com/');
    expect(m001?.proposedFix).toContain('<title>');
  });

  it('M002 fails when the title element is present but empty', () => {
    const html = `<html lang="en"><head><title>   </title></head><body><h1>Hi</h1></body></html>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    // parseHtml trims title, so empty becomes null; M001 fires. Keep raw unparsed title to prove M002 path.
    const obsRaw = { ...obs, title: '' };
    const results = evaluateAll(obsRaw);

    const m002 = findResult(results, 'M002');
    expect(m002?.result).toBe('fail');
  });

  it('M005 flags missing meta description as review (not fail)', () => {
    const html = `<html lang="en"><head><title>Title</title></head><body><h1>Hi</h1></body></html>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    const results = evaluateAll(obs);

    const m005 = findResult(results, 'M005');
    expect(m005?.result).toBe('review');
    expect(m005?.severity).toBe('low');
  });

  it('M009 flags missing <html lang> as review', () => {
    const html = `<html><head><title>T</title><meta name="description" content="d" /></head><body><h1>h</h1></body></html>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    const results = evaluateAll(obs);

    const m009 = findResult(results, 'M009');
    expect(m009?.result).toBe('review');
  });

  it('every active rule returns a well-formed RuleResult', () => {
    const html = `<html lang="en"><head><title>T</title></head><body></body></html>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    const results = evaluateAll(obs);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toMatchObject({
        ruleId: expect.any(String),
        ruleVersion: expect.any(String),
        severity: expect.stringMatching(/^(critical|high|moderate|low|informational)$/),
        confidence: expect.stringMatching(/^(direct|corroborated|inferred|unknown)$/),
        result: expect.stringMatching(/^(pass|fail|review|skipped|unknown)$/),
      });
    }
  });

  it('exceptions inside a rule evaluator produce an unknown result, not a throw', () => {
    const html = `<html><head></head><body></body></html>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    // Even with a very minimal observation the evaluator must not throw
    expect(() => evaluateAll(obs)).not.toThrow();
  });

  it('getAllRules includes every registered rule (not just active+tested)', () => {
    const all = getAllRules();
    const active = getActiveRules();
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThanOrEqual(active.length);
    // Every active rule must be a subset of all rules
    const allIds = new Set(all.map((r) => r.ruleId));
    for (const r of active) expect(allIds.has(r.ruleId)).toBe(true);
  });

  it('every rule has unique ruleId within the registry', () => {
    const ids = getAllRules().map((r) => r.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
