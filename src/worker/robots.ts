/**
 * Just enough robots.txt for an auditor: which paths a given user agent may
 * fetch, and which sitemaps the site declares. Follows the RFC 9309 rules
 * that matter here — the most specific matching group wins, the longest
 * matching rule wins, Allow beats Disallow on a tie, `*` and `$` patterns.
 */

type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[] };

export type Robots = {
  isAllowed: (userAgent: string, path: string) => boolean;
  /** True when the agent may fetch nothing at all ("Disallow: /" with no Allow). */
  blocksEverything: (userAgent: string) => boolean;
  sitemaps: string[];
};

export function parseRobots(text: string): Robots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow means "allow everything" — no rule needed.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }

  function groupFor(userAgent: string): Group | undefined {
    const ua = userAgent.toLowerCase();
    let best: Group | undefined;
    let bestLen = -1;
    for (const g of groups) {
      for (const a of g.agents) {
        if (a !== '*' && ua.includes(a) && a.length > bestLen) {
          best = g;
          bestLen = a.length;
        }
      }
    }
    return best ?? groups.find((g) => g.agents.includes('*'));
  }

  function matches(pattern: string, path: string): boolean {
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const re = new RegExp(
      '^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''),
    );
    return re.test(path);
  }

  function isAllowed(userAgent: string, path: string): boolean {
    const group = groupFor(userAgent);
    if (!group) return true;
    let verdict: Rule | undefined;
    for (const rule of group.rules) {
      if (!matches(rule.pattern, path)) continue;
      if (
        !verdict ||
        rule.pattern.length > verdict.pattern.length ||
        (rule.pattern.length === verdict.pattern.length && rule.allow)
      ) {
        verdict = rule;
      }
    }
    return verdict ? verdict.allow : true;
  }

  function blocksEverything(userAgent: string): boolean {
    const group = groupFor(userAgent);
    if (!group) return false;
    return !isAllowed(userAgent, '/') && !group.rules.some((r) => r.allow);
  }

  return { isAllowed, blocksEverything, sitemaps };
}
