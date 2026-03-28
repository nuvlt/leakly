import { crawlPage } from '../crawler';

export interface SearchQualityResult {
  searchUrl: string;
  keyword: string;
  testType: 'empty_query' | 'nonsense_query' | 'generic_query';
  productCount: number;
  isEmpty: boolean;
  hasIrrelevantResults: boolean;
  issue: string | null;
}

function countProducts(links: string[]): number {
  return links.filter(link => {
    const lower = link.toLowerCase();
    return (
      lower.includes('/product/') || lower.includes('/urun/') ||
      lower.includes('/p/') || lower.includes('/item/') ||
      /\/[a-z0-9-]+-p-\d+/.test(lower) ||
      /\/[a-z0-9-]+-pd-\d+/.test(lower) ||
      /\/\d{5,}(\/|$)/.test(lower)
    );
  }).length;
}

function buildSearchUrl(baseSearchUrl: string, keyword: string): string {
  try {
    const u = new URL(baseSearchUrl);
    const paramKeys = ['q', 's', 'query', 'keyword', 'search', 'ara', 'k'];
    let replaced = false;
    for (const key of paramKeys) {
      if (u.searchParams.has(key)) {
        u.searchParams.set(key, keyword);
        replaced = true;
        break;
      }
    }
    if (!replaced) u.searchParams.set('q', keyword);
    return u.toString();
  } catch {
    return baseSearchUrl;
  }
}

function extractSearchBaseUrl(pages: Array<{ url: string; type: string }>): string | null {
  const searchPage = pages.find(p => p.type === 'search');
  if (searchPage) return searchPage.url;

  for (const page of pages) {
    const lower = page.url.toLowerCase();
    if (
      lower.includes('/search?') || lower.includes('/ara?') ||
      lower.includes('?q=') || lower.includes('?s=') ||
      lower.includes('?query=') || lower.includes('?keyword=')
    ) return page.url;
  }

  return null;
}

async function runSingleSearchTest(
  searchBaseUrl: string,
  keyword: string,
  testType: SearchQualityResult['testType']
): Promise<SearchQualityResult | null> {
  const testUrl = buildSearchUrl(searchBaseUrl, keyword);
  const page = await crawlPage(testUrl);
  if (!page) return null;

  const productCount = countProducts(page.links);
  const isEmpty = productCount === 0;
  const hasIrrelevantResults = testType === 'nonsense_query' && productCount > 0;

  let issue: string | null = null;
  if (testType === 'empty_query' && isEmpty) {
    issue = 'Bos arama sorgusu hata sayfasi yerine bos sonuc donduruyor.';
  } else if (testType === 'nonsense_query' && hasIrrelevantResults) {
    issue = `Anlamsiz arama sorgusu "${keyword}" icin ${productCount} urun dondu - alakasiz sonuc sorunu.`;
  } else if (testType === 'generic_query' && isEmpty) {
    issue = `"${keyword}" gibi genel bir arama icin hic sonuc donmedi.`;
  }

  return { searchUrl: testUrl, keyword, testType, productCount, isEmpty, hasIrrelevantResults, issue };
}

export async function runSearchQualityTests(
  pages: Array<{ url: string; type: string }>,
  siteUrl: string
): Promise<SearchQualityResult[]> {
  const results: SearchQualityResult[] = [];

  let searchBaseUrl = extractSearchBaseUrl(pages);

  if (!searchBaseUrl) {
    try {
      const origin = new URL(siteUrl).origin;
      const candidates = [
        `${origin}/search?q=test`,
        `${origin}/ara?q=test`,
        `${origin}/?s=test`,
      ];
      for (const candidate of candidates) {
        const page = await crawlPage(candidate);
        if (page && page.statusCode === 200) {
          searchBaseUrl = candidate;
          break;
        }
        await new Promise(r => setTimeout(r, 300));
      }
    } catch {}
  }

  if (!searchBaseUrl) {
    console.log('[SearchTest] Arama URL bulunamadi, test atlandi.');
    return results;
  }

  console.log(`[SearchTest] Arama URL: ${searchBaseUrl}`);

  const isTurkish = siteUrl.includes('.tr') || siteUrl.includes('/tr/');
  const genericKeyword = isTurkish ? 'elbise' : 'dress';

  const tests: Array<{ keyword: string; type: SearchQualityResult['testType'] }> = [
    { keyword: '', type: 'empty_query' },
    { keyword: 'xqzjwk123456', type: 'nonsense_query' },
    { keyword: genericKeyword, type: 'generic_query' },
  ];

  for (const test of tests) {
    const result = await runSingleSearchTest(searchBaseUrl, test.keyword, test.type);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, 500));
  }

  return results;
}
