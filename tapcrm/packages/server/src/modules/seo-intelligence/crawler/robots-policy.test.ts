import { describe, expect, it } from 'vitest';
import { parseRobotsPolicy } from './robots-policy.js';
describe('crawl robots policy', () => {
  it('uses the most specific matching rule, with allow winning ties', () => {
    const policy = parseRobotsPolicy('User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /equal\nAllow: /equal');
    expect(policy.allows('https://example.com/private/a')).toBe(false);
    expect(policy.allows('https://example.com/private/public')).toBe(true);
    expect(policy.allows('https://example.com/equal')).toBe(true);
  });
  it('selects the bot group over the wildcard group and handles wildcard paths', () => {
    const policy = parseRobotsPolicy('User-agent: *\nDisallow: /\nUser-agent: TapcrmSeoBot\nDisallow: /*.pdf$\nCrawl-delay: 2');
    expect(policy.allows('https://example.com/page')).toBe(true);
    expect(policy.allows('https://example.com/file.pdf')).toBe(false);
    expect(policy.allows('https://example.com/file.pdf?download=1')).toBe(true);
    expect(policy.delayMs).toBe(2000);
  });
  it('ignores unrelated agents and empty disallow directives', () => {
    expect(parseRobotsPolicy('User-agent: otherbot\nDisallow: /').allows('https://example.com/')).toBe(true);
    expect(parseRobotsPolicy('User-agent: *\nDisallow:').allows('https://example.com/')).toBe(true);
  });
});
