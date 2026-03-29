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
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return lower; } })();
  const segments = path.split('/').filter(Boolean);

  if (
    lower.includes('/search') || lower.includes('?q=') ||
    lower.includes('?s=') || lower.includes('/ara') ||
    lower.includes('?query=') || lower.includes('/search-results') ||
    lower.includes('?keyword=') || lower.includes('/arama')
  ) return 'search';

  if (
    lower.includes('/product/') || lower.includes('/urun/') ||
    lower.includes('/p/') || lower.includes('/item/') ||
    lower.includes('/dp/') || lower.includes('/sku/') ||
    /\/[a-z0-9-]+-p-\d+/.test(lower) ||
    /\/[a-z0-9-]+-pd-\d+/.test(lower) ||
    /\-p\d+$/.test(path) ||
    /\/\d{5,}$/.test(path) ||
    /\/[a-z0-9]{8,}-[a-z0-9-]+$/.test(path) ||
    segments.some(s => /^[a-z0-9-]+-\d{4,}$/.test(s))
  ) return 'product';

  if (
    lower.includes('/category/') || lower.includes('/kategori/') ||
    lower.includes('/collections/') || lower.includes('/collection/') ||
    lower.includes('/cat/') || lower.includes('/c/') ||
    lower.includes('/department/') || lower.includes('/bolum/') ||
    lower.includes('/liste/') || lower.includes('/list/') ||
    lower.includes('/shop/') || lower.includes('/magaza/') ||
    /\/(kadin|erkek|cocuk|bebek|unisex)(\/|$|-)/i.test(path) ||
    /\/(women|men|kids|baby|girl|boy)(\/|$|-)/i.test(path) ||
    segments.some(s => [
      'gomlek', 'pantolon', 'elbise', 'ayakkabi', 'canta', 'aksesuar',
      'tisort', 'kazak', 'mont', 'ceket', 'etek', 'sort', 'tayt',
      'shirts', 'pants', 'dresses', 'shoes', 'bags', 'accessories',
      'jackets', 'coats', 'sweaters', 'skirts', 'tops', 'jeans',
      'elektronik', 'telefon', 'bilgisayar', 'tablet', 'televizyon',
      'mobilya', 'ev', 'mutfak', 'banyo', 'kozmetik', 'parfum',
      'spor', 'outdoor', 'kitap', 'muzik', 'oyun', 'hobi',
    ].includes(s))
  ) return 'category';

  return 'unknown';
}

function classifyBySitemapSource(sitemapUrl: string): CrawledPage['type'] | null {
  const lower = sitemapUrl.toLowerCase();
  if (lower.includes('category') || lower.includes('kategori') || lower.includes('collection')) return 'category';
  if (lower.includes('product') || lower.includes('urun')) return 'product';
  if (lower.includes('search') || lower.includes('ara')) return 'search';
  if (lower.includes('page') || lower.includes('brand') || lower.includes('footer') || lower.includes('city')) return 'unknown';
  return null;
}

function sitemapPriority(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes('category') || lower.includes('kategori')) return 0;
  if (lower.includes('search') || lower.includes('ara')) return 1;
  if (lower.includes('product') || lower.includes('urun')) return 2;
  if (lower.includes('page')) return 3;
  return 4;
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

function extractLocs(xml: string): string[] {
  const results: string[] = [];
  const regex = /<loc[^>]*>([\s\S]*?)<\/loc>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (url.startsWith('http') && !results.includes(url)) {
      results.push(url);
    }
  }
  return results;
}

function isSitemapIndex(xml: string): boolean {
  return xml.includes('<sitemapindex') || xml.includes('<sitemap>') || xml.includes('<sitemap ');
}

interface SitemapEntry {
  url: string;
  sourceType: CrawledPage['type'];
}

async function fetchSitemapEntries(baseUrl: string): Promise<SitemapEntry[]> {
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
      matches.forEach((m: string) => {
        const u = m.replace(/Sitemap:\s*/i, '').trim();
        if (!candidates.includes(u)) candidates.unshift(u);
      });
    }
  } catch {}

  for (const sitemapUrl of candidates) {
    try {
      const res = await httpClient.get(sitemapUrl);
      if (res.status !== 200 || typeof res.data !== 'string') continue;

      const locs = extractLocs(res.data);
      if (locs.length === 0) continue;

      if (isSitemapIndex(res.data)) {
        const entries: SitemapEntry[] = [];
        const sorted = [...locs].sort((a, b) => sitemapPriority(a) - sitemapPriority(b));
        const subSitemaps = sorted.slice(0, 5);

        console.log(`[Crawler] Sitemap index: ${locs.length} alt sitemap, ${subSitemaps.length} islenecek`);

        for (const subUrl of subSitemaps) {
          const sourceType = classifyBySitemapSource(subUrl) ?? 'unknown';
          try {
            const subRes = await httpClient.get(subUrl);
            if (subRes.status === 200 && typeof subRes.data === 'string') {
              const subLocs = extractLocs(subRes.data);
              subLocs.forEach((u: string) => {
                if (!entries.find(e => e.url === u)) {
                  entries.push({ url: u, sourceType });
                }
              });
              console.log(`[Crawler] ${subUrl} (${sourceType}) -> ${subLocs.length} URL`);
            }
          } catch {}
        }

        if (entries.length > 0) return entries;
      }

      console.log(`[Crawler] Sitemap: ${sitemapUrl} -> ${locs.length} URL`);
      return locs.map((url: string) => ({ url, sourceType: classifyUrl(url) }));
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

    $('a[href]').each(function() {
  const href = $(this).attr('href');
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
    onProgress?: (url: string, count: number, mode: CrawlerMode) => void;
  } = {}
): Promise<DiscoverResult> {
  const { maxPages = 500, maxDepth = 3, onProgress } = options;

  const sitemapEntries = await fetchSitemapEntries(startUrl);

  if (sitemapEntries.length > 0) {
    const pages: CrawledPage[] = [];
    const limited = sitemapEntries.slice(0, maxPages);

    for (const entry of limited) {
      onProgress?.(entry.url, pages.length + 1, 'sitemap');
      const page = await crawlPage(entry.url);
      if (page) {
        if (entry.sourceType !== 'unknown') {
          page.type = entry.sourceType;
        }
        pages.push(page);
      }
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

    onProgress?.(url, results.length + 1, 'html');
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

// Puppeteer fallback — JS-render siteler icin
export async function discoverPagesWithFallback(
  startUrl: string,
  options: {
    maxPages?: number;
    maxDepth?: number;
    onProgress?: (url: string, count: number, mode: CrawlerMode) => void;
  } = {}
): Promise<DiscoverResult> {
  const { maxPages = 500, onProgress } = options;

  // Once normal crawler dene
  const result = await discoverPages(startUrl, options);

  // Yeterli link bulunduysa Puppeteer'a gerek yok
  if (result.pages.length >= 10) {
    return result;
  }

  // Az link geldiyse Puppeteer devreye girsin
  console.log(`[Crawler] Az sayfa bulundu (${result.pages.length}), Puppeteer fallback basliyor...`);

  try {
    const { crawlPageWithPuppeteer } = await import('./puppeteer-crawler');

    // Oncelikle ana sayfayi Puppeteer ile tara, linkleri topla
    const mainPage = await crawlPageWithPuppeteer(startUrl);
    if (!mainPage) return result;

    onProgress?.(startUrl, 1, 'sitemap');

    const pages: CrawledPage[] = [{
      url: mainPage.url,
      statusCode: mainPage.statusCode,
      type: mainPage.type,
      links: mainPage.links,
      title: mainPage.title,
    }];

    // Bulunan linklerden kategori ve urun sayfalarini sec
    const priorityLinks = mainPage.links
      .filter(link => {
        const t = classifyUrl(link);
        return t === 'category' || t === 'product';
      })
      .slice(0, maxPages - 1);

    let count = 1;
    for (const link of priorityLinks) {
      count++;
      onProgress?.(link, count, 'sitemap');
      const page = await crawlPageWithPuppeteer(link);
      if (page) {
        pages.push({
          url: page.url,
          statusCode: page.statusCode,
          type: page.type,
          links: page.links,
          title: page.title,
        });
      }
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Crawler] Puppeteer fallback tamamlandi: ${pages.length} sayfa`);
    return { pages, mode: 'sitemap' };
  } catch (err) {
    console.error('[Crawler] Puppeteer fallback basarisiz:', err instanceof Error ? err.message : err);
    return result;
  }
}
