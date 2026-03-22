import axios from 'axios';
import * as cheerio from 'cheerio';

export interface CrawledPage {
  url: string;
  statusCode: number;
  type: 'category' | 'search' | 'product' | 'unknown';
  links: string[];
  title: string;
}

function classifyUrl(url: string): CrawledPage['type'] {
  const lower = url.toLowerCase();

  if (
    lower.includes('/search') ||
    lower.includes('?q=') ||
    lower.includes('?s=') ||
    lower.includes('/ara')
  ) {
    return 'search';
  }

  if (
    lower.includes('/product') ||
    lower.includes('/urun') ||
    lower.includes('/p/') ||
    /\/[a-z0-9-]+-p-\d+/.test(lower)
  ) {
    return 'product';
  }

  if (
    lower.includes('/category') ||
    lower.includes('/kategori') ||
    lower.includes('/c/') ||
    lower.includes('/collection')
  ) {
    return 'category';
  }

  return 'unknown';
}

function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    const base = new URL(baseUrl);
    if (url.hostname !== base.hostname) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export async function crawlPage(url: string): Promise<CrawledPage | null> {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'EcomAnalyzer/1.0 (Conversion Issue Scanner)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
      },
      maxRedirects: 5,
      validateStatus: () => true,
    });

    const $ = cheerio.load(response.data);

    const links: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const normalized = normalizeUrl(href, url);
      if (normalized && !links.includes(normalized)) {
        links.push(normalized);
      }
    });

    return {
      url,
      statusCode: response.status,
      type: classifyUrl(url),
      links,
      title: $('title').text().trim(),
    };
  } catch (err) {
    console.error(
      `Crawl error for ${url}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function discoverPages(
  startUrl: string,
  options: { maxPages?: number; maxDepth?: number } = {}
): Promise<CrawledPage[]> {
  const { maxPages = 50, maxDepth = 3 } = options;

  const visited = new Set<string>();
  const results: CrawledPage[] = [];
  const queue: Array<{ url: string; depth: number }> = [
    { url: startUrl, depth: 0 },
  ];

  while (queue.length > 0 && results.length < maxPages) {
    const item = queue.shift();
    if (!item) break;

    const { url, depth } = item;
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`[Crawler] Geziliyor (depth: ${depth}): ${url}`);
    const page = await crawlPage(url);
    if (!page) continue;

    results.push(page);

    if (depth < maxDepth) {
      for (const link of page.links) {
        if (!visited.has(link)) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }

    // Rate limiting — siteyi spam'leme
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return results;
}
