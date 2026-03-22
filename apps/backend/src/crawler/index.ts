import axios from 'axios';
import * as cheerio from 'cheerio';

export interface CrawledPage {
  url: string;
  statusCode: number;
  type: 'category' | 'search' | 'product' | 'unknown';
  links: string[];
  title: string;
}

export type CrawlerMode = 'sitemap' | 'html';

function classifyUrl(url: string): CrawledPage['type'] {
  const lower = url.toLowerCase();
  if (
    lower.includes('/search') || lower.includes('?q=') ||
    lower.includes('?s=') || lower.includes('/ara') ||
    lower.includes('?query=') || lower.includes('/search-results')
  ) return 'search';

  if (
    lower.includes('/product') || lower.includes('/urun') ||
    lower.includes('/p/') || /\/[a-z0-9-]+-p-\d+/.test(lower) ||
    lower.includes('/item/') || lower.includes('/dp/')
  ) return 'product';

  if (
    lower.includes('/category') || lower.includes('/kategori') ||
    lower.includes('/c/') || lower.includes('/collection') ||
    lower.includes('/collections/') || lower.includes('/cat/') ||
    lower.includes('/kadin') || lower.includes('/erkek') ||
    lower.includes('/women') || lower.includes('/men')
  ) return 'category';

  return 'unknown';
}

function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    const base = new URL(baseUrl);
    if (url.hostname !== base.hostname) return null;
    if (url.pathname.includes('cdn-cgi')) return null;
    if (url.pathname.match(/\.(jpg|jpeg|png|gif|svg|webp|css|js|ico|pdf|zip)$/i)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

const httpClient = axios.create({
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; LeaklyBot/1.0; +https://leakly.app)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  },
  maxRedirects: 5,
  validateStatus: () => true,
});

async function fetchSitemapUrls(baseUrl: string): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/sitemaps/sitemap.xml`,
  ];

  try {
    const robotsRes = await httpClient.get(`${origin}/robots.txt`);
    if (robotsRes.status === 200 && typeof robotsRes.data === 'string') {
      const matches = robotsRes.data.match(/Sitemap:\s*(.+)/gi) || [];
      matches.forEach(m => {
        const u = m.replace(/Sitemap:\s*/i, '').trim();
        if (!candidates.includes(u)) candidates.unshift(u);
      });
    }
  } catch {}

  for (const sitemapUrl of candidates) {
    try {
      const res = await httpClient.get(sitemapUrl);
      if (res.status !== 200 || typeof res.data !== 'string') continue;

      const $ = cheerio.load(res.data, { xmlMode: true });
      const urls: string[] = [];

      const subSitemapEls = $('sitemap loc').toArray();
      if (subSitemapEls.length > 0) {
        for (const el of subSitemapEls.slice(0, 4)) {
          const subUrl = $(el).text().trim();
          try {
            const subRes = await httpClient.get(subUrl);
            if (subRes.status === 200 && typeof subRes.data === 'string') {
              const $sub = cheerio.load(subRes.data, { xmlMode: true });
              $sub('url loc').each((_, e) => {
                const u = $sub(e).text().trim();
                if (u && !urls.includes(u)) urls.push(u);
              });
            }
          } catch {}
        }
        if (urls.length > 0) {
          console.log(`[Crawler] Sitemap index: ${sitemapUrl} → ${urls.length} URL`);
          return urls;
        }
      }

      $('url loc').each((_, el) => {
        const u = $(el).text().trim();
        if (u && !urls.includes(u)) urls.push(u);
      });

      if (urls.length > 0) {
        console.log(`[Crawler] Sitemap: ${sitemapUrl} → ${urls.length} URL`);
        return urls;
      }
    } catch {}
  }

  return [];
}

export async function crawlPage(url: string): Promise<CrawledPage | null> {
  try {
    const response = await httpClient.get(url);
    const contentType = String(response.headers['content-type'] || '');

    if (!contentType.includes('text/html')) {
      return { url, statusCode: response.status, type: classifyUrl(url), links: [], title: '' };
    }

    const $ = cheerio.load(response.data);
    const links: string[] = [];

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const normalized = normalizeUrl(href, url);
      if (normalized && !links.includes(normalized)) links.push(normalized);
    });

    return {
      url,
      statusCode: response.status,
      type: classifyUrl(url),
      links,
      title: $('title').text().trim(),
    };
  } catch (err) {
    console.error(`Crawl error ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export interface DiscoverResult {
  pages: CrawledPage[];
  mode: CrawlerMode;
}

export async function discoverPages(
  startUrl: string,
  options: {
    maxPages?: number;
    maxDepth?: number;
    onProgress?: (url: string, count: number) => void;
  } = {}
): Promise<DiscoverResult> {
  const { maxPages = 200, maxDepth = 3, onProgress } = options;

  const sitemapUrls = await fetchSitemapUrls(startUrl);

  if (sitemapUrls.length > 0) {
    const pages: CrawledPage[] = [];
    const limited = sitemapUrls.slice(0, maxPages);

    for (const url of limited) {
      onProgress?.(url, pages.length + 1);
      const page = await crawlPage(url);
      if (page) pages.push(page);
      await new Promise(r => setTimeout(r, 150));
    }

    return { pages, mode: 'sitemap' };
  }

  console.log(`[Crawler] HTML BFS modu`);
  const visited = new Set<string>();
  const results: CrawledPage[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];

  while (queue.length > 0 && results.length < maxPages) {
    const item = queue.shift();
    if (!item) break;
    const { url, depth } = item;
    if (visited.has(url)) continue;
    visited.add(url);

    onProgress?.(url, results.length + 1);
    console.log(`[Crawler] BFS (d:${depth}): ${url}`);

    const page = await crawlPage(url);
    if (!page) continue;
    results.push(page);

    if (depth < maxDepth) {
      for (const link of page.links) {
        if (!visited.has(link)) queue.push({ url: link, depth: depth + 1 });
      }
    }

    await new Promise(r => setTimeout(r, 300));
  }

  return { pages: results, mode: 'html' };
}
