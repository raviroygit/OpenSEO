/**
 * URL helpers shared by the web app (validating what a user types) and the
 * worker (deciding what the crawler may follow).
 */

/**
 * "example.com", "https://www.example.com/blog?x=1" → "https://example.com" /
 * "https://www.example.com". Throws a user-facing message on anything that
 * isn't a public http(s) site.
 */
export function normaliseDomain(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('Enter a website address.');
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error(`"${raw}" is not a valid website address.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) websites can be audited.');
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error('Private and local addresses cannot be audited.');
  }
  if (!url.hostname.includes('.')) {
    throw new Error(`"${url.hostname}" is not a public domain.`);
  }
  return url.origin;
}

/**
 * The crawler must never be pointed at the instance's own network (cloud
 * metadata endpoints, databases, the Docker host). Blocks literal private
 * addresses and local names; DNS-level checks happen at fetch time.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (h.includes(':')) {
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h === '::';
  }
  return false;
}

/** Drops the fragment and a trailing slash on non-root paths, so one page has one key. */
export function canonicalKey(url: URL): string {
  const u = new URL(url.toString());
  u.hash = '';
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

/** www.example.com and example.com count as the same site. */
export function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, '');
  return strip(a) === strip(b);
}
