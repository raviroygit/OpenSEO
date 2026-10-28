import type { AuditSummary, IssueCategory, IssueCounts, Severity } from '../db/schema';
import type { CrawlResult, PageFacts } from './crawler';

export type Issue = {
  code: string;
  category: IssueCategory;
  severity: Severity;
  message: string;
  pageUrl: string | null;
  details?: Record<string, unknown>;
};

/**
 * AI crawlers worth checking robots.txt against. Blocking these keeps a site
 * out of AI answers (ChatGPT, Claude, Perplexity, Gemini, Common Crawl-based
 * models) — sometimes deliberate, often an accident of a blanket rule.
 */
export const AI_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
] as const;

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 12, warning: 4, notice: 1 };
const ORG_TYPES = ['Organization', 'LocalBusiness', 'WebSite', 'Corporation', 'Store', 'OnlineStore'];
const ARTICLE_PATH = /\/(blog|news|articles?|posts?|guides?)\//i;

/** A page search engines and AI can actually index: fetched, HTML, 2xx, not noindex. */
function indexable(p: PageFacts): boolean {
  return p.isHtml && p.status !== null && p.status >= 200 && p.status < 300 && !p.noindex;
}

export function analyse(crawl: CrawlResult): {
  issues: Issue[];
  technicalScore: number;
  geoScore: number;
  counts: IssueCounts;
  summary: AuditSummary;
} {
  const issues: Issue[] = [];
  const add = (i: Issue) => issues.push(i);
  const pages = crawl.pages;
  const good = pages.filter(indexable);
  const statusByUrl = new Map<string, number | null>();
  for (const p of pages) {
    statusByUrl.set(p.requestedUrl, p.status);
    statusByUrl.set(p.url, p.status);
  }
  const home = pages[0];

  // ---------------------------------------------------------------- site
  if (!crawl.finalOrigin.startsWith('https://')) {
    add({ code: 'not-https', category: 'technical', severity: 'critical', pageUrl: null, message: 'The site is not served over HTTPS.' });
  } else if (crawl.httpRedirectsToHttps === false) {
    add({ code: 'http-not-redirected', category: 'technical', severity: 'warning', pageUrl: null, message: 'http:// does not redirect to https:// — two versions of the site exist.' });
  }
  if (!crawl.robotsTxt) {
    add({ code: 'robots-missing', category: 'technical', severity: 'notice', pageUrl: null, message: 'No robots.txt found.' });
  }
  if (crawl.robots?.blocksEverything('Googlebot')) {
    add({ code: 'robots-blocks-search', category: 'technical', severity: 'critical', pageUrl: null, message: 'robots.txt blocks Google from the entire site.' });
  }
  if (!crawl.sitemapUrl) {
    add({ code: 'sitemap-missing', category: 'technical', severity: 'warning', pageUrl: null, message: 'No XML sitemap found (checked robots.txt and /sitemap.xml).' });
  }

  const blockedAiBots = crawl.robots ? AI_BOTS.filter((b) => crawl.robots!.blocksEverything(b)) : [];
  if (blockedAiBots.length) {
    add({
      code: 'ai-bots-blocked',
      category: 'geo',
      severity: blockedAiBots.length >= AI_BOTS.length - 1 ? 'critical' : 'warning',
      pageUrl: null,
      message: `robots.txt blocks ${blockedAiBots.length} AI crawler(s) from the whole site: ${blockedAiBots.join(', ')}.`,
      details: { bots: blockedAiBots },
    });
  }
  if (!crawl.llmsTxt) {
    add({ code: 'llms-txt-missing', category: 'geo', severity: 'notice', pageUrl: null, message: 'No /llms.txt — a short guide that helps AI assistants understand the site.' });
  }

  // ------------------------------------------------------- per page (tech)
  const titles = new Map<string, string[]>();
  const descriptions = new Map<string, string[]>();

  for (const p of pages) {
    if (p.status === null) {
      add({ code: 'fetch-failed', category: 'technical', severity: 'critical', pageUrl: p.requestedUrl, message: `Page could not be loaded: ${p.fetchError ?? 'no response'}.` });
      continue;
    }
    if (p.status >= 400) {
      add({ code: p.status >= 500 ? 'http-5xx' : 'http-4xx', category: 'technical', severity: 'critical', pageUrl: p.requestedUrl, message: `Page returns HTTP ${p.status}.`, details: { status: p.status } });
      continue;
    }
    if (p.redirects >= 2) {
      add({ code: 'redirect-chain', category: 'technical', severity: 'warning', pageUrl: p.requestedUrl, message: `${p.redirects} redirects before the page loads.`, details: { finalUrl: p.url } });
    }
    if (!p.isHtml) continue;
    if (p.loadMs > 3000) {
      add({ code: 'slow-response', category: 'technical', severity: 'warning', pageUrl: p.url, message: `Slow response: ${(p.loadMs / 1000).toFixed(1)}s to download the HTML.`, details: { loadMs: p.loadMs } });
    }
    if (p.bytes > 1024 * 1024) {
      add({ code: 'html-too-large', category: 'technical', severity: 'notice', pageUrl: p.url, message: `HTML is ${(p.bytes / 1024 / 1024).toFixed(1)} MB.` });
    }
    if (p.noindex) {
      add({ code: 'noindex', category: 'technical', severity: 'warning', pageUrl: p.url, message: 'Page is set to noindex — it will not appear in search results.' });
      continue;
    }

    if (!p.title) {
      add({ code: 'title-missing', category: 'technical', severity: 'critical', pageUrl: p.url, message: 'Missing <title>.' });
    } else {
      titles.set(p.title, [...(titles.get(p.title) ?? []), p.url]);
      if (p.title.length > 60) add({ code: 'title-too-long', category: 'technical', severity: 'warning', pageUrl: p.url, message: `Title is ${p.title.length} characters; search results cut it off around 60.`, details: { title: p.title } });
      else if (p.title.length < 15) add({ code: 'title-too-short', category: 'technical', severity: 'notice', pageUrl: p.url, message: `Title is only ${p.title.length} characters.`, details: { title: p.title } });
    }
    if (!p.metaDescription) {
      add({ code: 'meta-description-missing', category: 'technical', severity: 'warning', pageUrl: p.url, message: 'Missing meta description.' });
    } else {
      descriptions.set(p.metaDescription, [...(descriptions.get(p.metaDescription) ?? []), p.url]);
      if (p.metaDescription.length > 160) add({ code: 'meta-description-too-long', category: 'technical', severity: 'notice', pageUrl: p.url, message: `Meta description is ${p.metaDescription.length} characters; ~160 are shown.` });
    }
    // A client-rendered page whose h1 lives in its <noscript> fallback is
    // reported once, as content-in-noscript-only below, not also here.
    const jsRendered = p.wordCount < 50 && p.scriptCount >= 1;
    if (p.h1Count === 0 && !(jsRendered && p.noscriptH1)) add({ code: 'h1-missing', category: 'technical', severity: 'warning', pageUrl: p.url, message: 'No <h1> heading.' });
    else if (p.h1Count > 1) add({ code: 'h1-multiple', category: 'technical', severity: 'notice', pageUrl: p.url, message: `${p.h1Count} <h1> headings; one is clearer.` });

    if (!p.canonical) {
      add({ code: 'canonical-missing', category: 'technical', severity: 'notice', pageUrl: p.url, message: 'No canonical URL.' });
    } else {
      try {
        const c = new URL(p.canonical, p.url);
        if (c.origin !== new URL(p.url).origin) {
          add({ code: 'canonical-offsite', category: 'technical', severity: 'warning', pageUrl: p.url, message: `Canonical points to another origin: ${c.origin}.`, details: { canonical: c.toString() } });
        }
      } catch {
        add({ code: 'canonical-invalid', category: 'technical', severity: 'warning', pageUrl: p.url, message: `Canonical URL is invalid: ${p.canonical}.` });
      }
    }
    if (!p.hasViewport) add({ code: 'viewport-missing', category: 'technical', severity: 'warning', pageUrl: p.url, message: 'No viewport meta tag — the page is not mobile-friendly.' });
    if (!p.lang) add({ code: 'lang-missing', category: 'technical', severity: 'notice', pageUrl: p.url, message: 'No lang attribute on <html>.' });
    if (p.imagesWithoutAlt > 0) add({ code: 'img-alt-missing', category: 'technical', severity: 'warning', pageUrl: p.url, message: `${p.imagesWithoutAlt} of ${p.images} image(s) have no alt text.`, details: { count: p.imagesWithoutAlt } });
    if (!p.ogTitle || !p.ogImage) add({ code: 'open-graph-missing', category: 'technical', severity: 'notice', pageUrl: p.url, message: `Missing Open Graph ${[!p.ogTitle && 'title', !p.ogImage && 'image'].filter(Boolean).join(' and ')} — link previews will be plain.` });
    if (p.insecureLinks > 0) add({ code: 'insecure-links', category: 'technical', severity: 'warning', pageUrl: p.url, message: `${p.insecureLinks} internal link(s) use http://.` });

    const broken = p.internalLinks.filter((l) => {
      const s = statusByUrl.get(l);
      return s !== undefined && (s === null || s >= 400);
    });
    if (broken.length) add({ code: 'broken-links', category: 'technical', severity: 'critical', pageUrl: p.url, message: `${broken.length} broken internal link(s).`, details: { links: broken.slice(0, 20) } });

    // -------------------------------------------------------- per page (GEO)
    if (p.jsonLdInvalid > 0) add({ code: 'structured-data-invalid', category: 'geo', severity: 'warning', pageUrl: p.url, message: `${p.jsonLdInvalid} JSON-LD block(s) are not valid JSON.` });
    if (jsRendered && (p.noscriptH1 || p.noscriptWords >= 40)) {
      add({
        code: 'content-in-noscript-only',
        category: 'geo',
        severity: 'warning',
        pageUrl: p.url,
        message: `The visible page is rendered by JavaScript; crawlers that don't run it read only the <noscript> fallback (${p.noscriptWords} words). That works, but search engines give <noscript> text little weight — server-rendered HTML is stronger.`,
        details: { noscriptWords: p.noscriptWords, renderedWords: p.wordCount },
      });
    } else if (jsRendered) {
      add({ code: 'content-requires-js', category: 'geo', severity: 'warning', pageUrl: p.url, message: `Only ${p.wordCount} word${p.wordCount === 1 ? ' is' : 's are'} in the HTML; the content is rendered by JavaScript, which most AI crawlers do not run.`, details: { wordCount: p.wordCount } });
    } else if (p.wordCount < 300) {
      add({ code: 'thin-content', category: 'geo', severity: 'notice', pageUrl: p.url, message: `Thin content: ${p.wordCount} words.`, details: { wordCount: p.wordCount } });
    } else if (p.h2Count === 0) {
      add({ code: 'no-subheadings', category: 'geo', severity: 'notice', pageUrl: p.url, message: 'Long page with no <h2> subheadings — harder for AI to extract answers from.' });
    }
    if (p !== home && p.jsonLdTypes.length === 0) add({ code: 'structured-data-missing', category: 'geo', severity: 'notice', pageUrl: p.url, message: 'No structured data (JSON-LD).' });
    if (ARTICLE_PATH.test(new URL(p.url).pathname) && !p.publishedTime) {
      add({ code: 'article-date-missing', category: 'geo', severity: 'notice', pageUrl: p.url, message: 'Article has no machine-readable publish date.' });
    }
  }

  for (const [title, urls] of titles) {
    if (urls.length > 1) for (const u of urls) add({ code: 'title-duplicate', category: 'technical', severity: 'warning', pageUrl: u, message: `Title shared with ${urls.length - 1} other page(s): "${title}".` });
  }
  for (const [, urls] of descriptions) {
    if (urls.length > 1) for (const u of urls) add({ code: 'meta-description-duplicate', category: 'technical', severity: 'notice', pageUrl: u, message: `Meta description shared with ${urls.length - 1} other page(s).` });
  }

  if (home && indexable(home)) {
    if (home.jsonLdTypes.length === 0) {
      add({ code: 'home-structured-data-missing', category: 'geo', severity: 'warning', pageUrl: home.url, message: 'Home page has no structured data — search engines and AI cannot reliably tell who the site belongs to.' });
    } else if (!home.jsonLdTypes.some((t) => ORG_TYPES.includes(t))) {
      add({ code: 'organization-schema-missing', category: 'geo', severity: 'notice', pageUrl: home.url, message: 'Home page structured data has no Organization / WebSite entity.' });
    }
  }

  // ---------------------------------------------------------------- scores
  const denominator = Math.max(1, good.length);
  const score = (category: IssueCategory) => {
    const byCode = new Map<string, { severity: Severity; pages: Set<string | null> }>();
    for (const i of issues) {
      if (i.category !== category) continue;
      const entry = byCode.get(i.code) ?? { severity: i.severity, pages: new Set() };
      entry.pages.add(i.pageUrl);
      byCode.set(i.code, entry);
    }
    let penalty = 0;
    for (const { severity, pages: affected } of byCode.values()) {
      const share = affected.has(null) ? 1 : Math.min(1, affected.size / denominator);
      penalty += SEVERITY_WEIGHT[severity] * (0.4 + 0.6 * share);
    }
    return Math.max(0, Math.round(100 - penalty));
  };

  const counts: IssueCounts = { critical: 0, warning: 0, notice: 0 };
  for (const i of issues) counts[i.severity]++;

  return {
    issues,
    technicalScore: score('technical'),
    geoScore: score('geo'),
    counts,
    summary: {
      finalUrl: crawl.finalOrigin,
      https: crawl.finalOrigin.startsWith('https://'),
      robotsTxt: !!crawl.robotsTxt,
      sitemap: crawl.sitemapUrl,
      llmsTxt: crawl.llmsTxt,
      blockedAiBots: [...blockedAiBots],
      pagesSkippedByRobots: crawl.skippedByRobots,
    },
  };
}
