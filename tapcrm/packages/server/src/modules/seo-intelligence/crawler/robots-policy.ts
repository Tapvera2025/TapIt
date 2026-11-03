import { safeFetch } from './http.js';

interface Rule { path: string; allow: boolean }
export interface RobotsPolicy { allows(url: string): boolean; delayMs: number; reason: string }

export function parseRobotsPolicy(body: string): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: Rule[]; delayMs: number }> = [];
  let group = { agents: [] as string[], rules: [] as Rule[], delayMs: 0 };
  let directives = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.split('#')[0]?.trim() ?? '';
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === 'user-agent') {
      if (directives) { groups.push(group); group = { agents: [], rules: [], delayMs: 0 }; directives = false; }
      group.agents.push(value.toLowerCase());
    } else if (group.agents.length && (name === 'allow' || name === 'disallow')) {
      directives = true;
      if (value) group.rules.push({ path: value, allow: name === 'allow' });
    } else if (group.agents.length && name === 'crawl-delay') {
      directives = true;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) group.delayMs = Math.min(30_000, seconds * 1000);
    }
  }
  groups.push(group);
  const scores = groups.map(g => Math.max(-1, ...g.agents.map(agent => agent === '*' ? 0 : agent && 'tapcrmseobot'.includes(agent) ? agent.length : -1)));
  const best = Math.max(...scores);
  const selected = groups.filter((_g, index) => best >= 0 && scores[index] === best);
  const rules = selected.flatMap(g => g.rules);
  return {
    reason: 'Blocked by robots.txt', delayMs: Math.max(0, ...selected.map(g => g.delayMs)),
    allows(url) {
      const parsed = new URL(url);
      const path = parsed.pathname + parsed.search;
      let winner: Rule | undefined;
      let specificity = -1;
      for (const rule of rules) {
        const anchored = rule.path.endsWith('$');
        const pattern = (anchored ? rule.path.slice(0, -1) : rule.path).split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        const size = rule.path.replace(/[*$]/g, '').length;
        if (new RegExp('^' + pattern + (anchored ? '$' : '')).test(path) && (size > specificity || size === specificity && rule.allow)) {
          winner = rule; specificity = size;
        }
      }
      return !winner || winner.allow;
    },
  };
}

export async function loadRobotsPolicy(origin: string): Promise<RobotsPolicy> {
  try {
    const response = await safeFetch(new URL('/robots.txt', origin).toString(), { maxBytes: 512_000, timeoutMs: 10_000 });
    if (response.status >= 200 && response.status < 300 && !response.truncated) return parseRobotsPolicy(response.body);
    if (response.status === 404 || response.status === 410) return parseRobotsPolicy('');
    return { allows: () => false, delayMs: 0, reason: `Robots access could not be established (HTTP ${response.status})` };
  } catch { return { allows: () => false, delayMs: 0, reason: 'Robots access could not be established' }; }
}
