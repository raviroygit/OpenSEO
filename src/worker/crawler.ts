import { lookup } from 'node:dns/promises';
import * as cheerio from 'cheerio';
import { canonicalKey, isPrivateHost, sameSite } from '../lib/url';
import { parseRobots, type Robots } from './robots';

export const USER_AGENT = 'OpenSEO-Bot/0.1 (+https://github.com/raviroygit/OpenSEO)';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const CONCURRENCY = 4;
// Infrastructure paths that aren't pages: Cloudflare rewrites every email
// address on a proxied site into /cdn-cgi/l/email-protection (a 404 decoded
// by JavaScript), which would otherwise show up as a broken link everywhere.
const SKIP_PATHS = /^\/cdn-cgi\//;
const SKIP_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|zip|gz|rar|7z|mp4|webm|mov|mp3|wav|woff2?|ttf|eot|docx?|xlsx?|pptx?|csv)$/i;

/** Everything the checks need to know about one fetched page. */
export type PageFacts = {
  url: string;
  requestedUrl: string;
  depth: number;
  status: number | null;
  /** Network/timeout failure, when there was no HTTP response at all. */
  fetchError?: string;
  redirects: number;
  loadMs: number;
  isHtml: boolean;
  bytes: number;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  h2Count: number;
  canonical: string | null;
  noindex: boolean;
  lang: string | null;
  hasViewport: boolean;
  ogTitle: boolean;
  ogImage: boolean;
  images: number;
  imagesWithoutAlt: number;
  jsonLdTypes: string[];
  jsonLdInvalid: number;
  wordCount: number;
  /** Words / h1s in <noscript> fallbacks — what no-JS crawlers can still read
   *  on a client-rendered page (e.g. an Expo / SPA build that bakes copy in). */
  noscriptWords: number;
  noscriptH1: boolean;
  scriptCount: number;
  publishedTime: boolean;
  /** Same-site links found on the page (canonical keys). */
  internalLinks: string[];
  insecureLinks: number;
};

export type CrawlResult = {
  finalOrigin: string;
  pages: PageFacts[];
  robotsTxt: string | null;
  robots: Robots | null;
  sitemapUrl: string | null;
  sitemapUrls: number;
  llmsTxt: boolean;
  skippedByRobots: number;
  httpRedirectsToHttps: boolean | null;
};

type FetchOutcome = {
  finalUrl: string;
  status: number | null;
  redirects: number;
  loadMs: number;
  contentType: string;
  body: string;
  error?: string;
};

async function assertPublic(url: URL): Promise<void> {
  if (isPrivateHost(url.hostname)) throw new Error(`blocked private host ${url.hostname}`);
  const { address } = await lookup(url.hostname);
  if (isPrivateHost(address)) throw new Error(`${url.hostname} resolves to a private address`);
}

/** GET with manual redirects, so every hop is checked and counted. */
async function fetchPage(rawUrl: string, maxBytes = MAX_HTML_BYTES): Promise<FetchOutcome> {
  const started = Date.now();
  let url = new URL(rawUrl);
  let redirects = 0;
  try {
    for (;;) {
      await assertPublic(url);
      const res = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (++redirects > MAX_REDIRECTS) {
          return { finalUrl: url.toString(), status: res.status, redirects, loadMs: Date.now() - started, contentType: '', body: '', error: 'too many redirects' };
        }
        url = new URL(location, url);
        continue;
      }
      const contentType = res.headers.get('content-type') ?? '';
      let body = '';
      if (res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
      return { finalUrl: url.toString(), status: res.status, redirects, loadMs: Date.now() - started, contentType, body };
    }
  } catch (err) {
    return {
      finalUrl: url.toString(),
      status: null,
      redirects,
      loadMs: Date.now() - started,
      contentType: '',
      body: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function extractFacts(outcome: FetchOutcome, requestedUrl: string, depth: number, origin: URL): PageFacts {
  const isHtml = /text\/html|application\/xhtml/i.test(outcome.contentType);
  const base: PageFacts = {
    url: outcome.finalUrl,
    requestedUrl,
    depth,
    status: outcome.status,
    fetchError: outcome.error,
    redirects: outcome.redirects,
    loadMs: outcome.loadMs,
    isHtml,
    bytes: Buffer.byteLength(outcome.body),
    title: null,
    metaDescription: null,
    h1Count: 0,
    h2Count: 0,
    canonical: null,
    noindex: false,
    lang: null,
    hasViewport: false,
    ogTitle: false,
    ogImage: false,
    images: 0,
    imagesWithoutAlt: 0,
    jsonLdTypes: [],
    jsonLdInvalid: 0,
    wordCount: 0,
    noscriptWords: 0,
    noscriptH1: false,
    scriptCount: 0,
    publishedTime: false,
    internalLinks: [],
    insecureLinks: 0,
  };
  if (!isHtml || !outcome.body) return base;

  const $ = cheerio.load(outcome.body);
  const meta = (name: string) =>
    $(`meta[name="${name}" i], meta[property="${name}" i]`).first().attr('content')?.trim() || null;

  base.title = $('head > title').first().text().trim() || $('title').first().text().trim() || null;
  base.metaDescription = meta('description');
  base.h1Count = $('h1').length;
  base.h2Count = $('h2').length;
  base.canonical = $('link[rel="canonical" i]').first().attr('href')?.trim() || null;
  base.noindex = /noindex/i.test(meta('robots') ?? '');
  base.lang = $('html').attr('lang')?.trim() || null;
  base.hasViewport = !!meta('viewport');
  base.ogTitle = !!meta('og:title');
  base.ogImage = !!meta('og:image');
  base.publishedTime = !!(meta('article:published_time') || $('time[datetime]').length);
  base.scriptCount = $('script').length;

  $('img').each((_, el) => {
    base.images++;
    const alt = $(el).attr('alt');
    if (alt === undefined) base.imagesWithoutAlt++;
  });

  $('script[type="application/ld+json" i]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const nodes = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const n of nodes) {
        const t = n?.['@type'];
        if (typeof t === 'string') base.jsonLdTypes.push(t);
        else if (Array.isArray(t)) base.jsonLdTypes.push(...t.filter((x) => typeof x === 'string'));
      }
    } catch {
      base.jsonLdInvalid++;
    }
  });

  // Visible text only: what a browser renders before any script runs.
  const $body = $('body').clone();
  $body.find('script, style, noscript, template, svg').remove();
  const text = $body.text().replace(/\s+/g, ' ').trim();
  base.wordCount = text ? text.split(' ').length : 0;

  // <noscript> content is parsed as raw text (as a JS-capable browser does),
  // so read it separately: client-rendered sites often put their real copy
  // there for crawlers, and calling that page "0 words, no h1" misleads.
  let fallback = '';
  $('noscript').each((_, el) => {
    fallback += ' ' + ($(el).html() ?? '');
  });
  if (fallback.trim()) {
    const $f = cheerio.load(fallback);
    $f('script, style').remove();
    const ftext = $f.root().text().replace(/\s+/g, ' ').trim();
    base.noscriptWords = ftext ? ftext.split(' ').length : 0;
    base.noscriptH1 = $f('h1').length > 0;
  }

  const pageUrl = new URL(outcome.finalUrl);
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    let target: URL;
    try {
      target = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (target.protocol === 'http:' && pageUrl.protocol === 'https:' && sameSite(target.hostname, origin.hostname)) {
      base.insecureLinks++;
    }
    if (!/^https?:$/.test(target.protocol) || !sameSite(target.hostname, origin.hostname)) return;
    if (SKIP_EXTENSIONS.test(target.pathname) || SKIP_PATHS.test(target.pathname)) return;
    links.add(canonicalKey(target));
  });
  base.internalLinks = [...links];
  return base;
}

async function fetchText(url: string): Promise<{ ok: boolean; text: string; finalUrl: string }> {
  const r = await fetchPage(url, 1024 * 1024);
  const ok = r.status !== null && r.status >= 200 && r.status < 300 && !/text\/html/i.test(r.contentType);
  return { ok, text: ok ? r.body : '', finalUrl: r.finalUrl };
}

/** Sitemap URLs (follows one level of sitemap indexes, bounded). */
async function readSitemap(url: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const first = await fetchText(url);
  if (!first.ok) return out;
  const locs = [...first.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  if (/<sitemapindex/i.test(first.text)) {
    for (const child of locs.slice(0, 5)) {
      const r = await fetchText(child);
      if (!r.ok) continue;
      for (const m of r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        out.push(m[1]);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }
  return locs.slice(0, limit);
}

/**
 * Breadth-first, same-site crawl from the project's domain, seeded with its
 * sitemap, bounded by maxPages, CONCURRENCY requests at a time.
 */
export async function crawlSite(domain: string, maxPages: number): Promise<CrawlResult> {
  const home = await fetchPage(domain);
  if (home.status === null) {
    throw new Error(`Could not reach ${domain}: ${home.error ?? 'no response'}`);
  }
  const origin = new URL(new URL(home.finalUrl).origin);

  // Does plain http:// redirect to https://?
  let httpRedirectsToHttps: boolean | null = null;
  if (origin.protocol === 'https:') {
    const plain = await fetchPage(`http://${origin.host}/`, 64 * 1024);
    httpRedirectsToHttps = plain.status !== null ? plain.finalUrl.startsWith('https://') : null;
  }

  const robotsRes = await fetchText(new URL('/robots.txt', origin).toString());
  const robots = robotsRes.ok ? parseRobots(robotsRes.text) : null;
  const llms = await fetchText(new URL('/llms.txt', origin).toString());

  const sitemapCandidates = robots?.sitemaps.length ? robots.sitemaps : [new URL('/sitemap.xml', origin).toString()];
  let sitemapUrl: string | null = null;
  let sitemapEntries: string[] = [];
  for (const candidate of sitemapCandidates.slice(0, 3)) {
    const entries = await readSitemap(candidate, maxPages * 2);
    if (entries.length) {
      sitemapUrl = candidate;
      sitemapEntries = entries;
      break;
    }
  }

  const seen = new Set<string>();
  const queue: { url: string; depth: number }[] = [];
  let skippedByRobots = 0;
  const enqueue = (raw: string, depth: number) => {
    let u: URL;
    try {
      u = new URL(raw, origin);
    } catch {
      return;
    }
    if (!sameSite(u.hostname, origin.hostname) || SKIP_EXTENSIONS.test(u.pathname) || SKIP_PATHS.test(u.pathname)) return;
    const key = canonicalKey(u);
    if (seen.has(key)) return;
    seen.add(key);
    if (robots && !robots.isAllowed(USER_AGENT, u.pathname + u.search)) {
      skippedByRobots++;
      return;
    }
    queue.push({ url: key, depth });
  };

  // The home page is already fetched; record it first.
  seen.add(canonicalKey(new URL(domain)));
  seen.add(canonicalKey(origin));
  const pages: PageFacts[] = [extractFacts(home, domain, 0, origin)];
  for (const l of pages[0].internalLinks) enqueue(l, 1);
  for (const s of sitemapEntries) enqueue(s, 1);

  async function workerLoop(): Promise<void> {
    while (pages.length < maxPages) {
      const next = queue.shift();
      if (!next) return;
      const outcome = await fetchPage(next.url);
      if (pages.length >= maxPages) return;
      const facts = extractFacts(outcome, next.url, next.depth, origin);
      pages.push(facts);
      for (const l of facts.internalLinks) enqueue(l, next.depth + 1);
    }
  }
  // Keep pulling until the queue is drained or the page budget is spent.
  while (queue.length && pages.length < maxPages) {
    await Promise.all(Array.from({ length: CONCURRENCY }, workerLoop));
  }

  return {
    finalOrigin: origin.origin,
    pages,
    robotsTxt: robotsRes.ok ? robotsRes.text : null,
    robots,
    sitemapUrl,
    sitemapUrls: sitemapEntries.length,
    llmsTxt: llms.ok && llms.text.trim().length > 0,
    skippedByRobots,
    httpRedirectsToHttps,
  };
}
