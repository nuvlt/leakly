import { crawlPage } from '../crawler';

export interface FilterTestResult {
  categoryUrl: string;
  params: Record<string, string>;
  combinations: Array<{
    url: string;
    productIds: string[];
  }>;
  isInconsistent: boolean;
  difference: {
    onlyInFirst: string[];
    onlyInSecond: string[];
  };
}

// URL'deki query parametrelerini çıkar
function extractParams(url: string): Record<string, string> {
  try {
    const u = new URL(url);
    const params: Record<string, string> = {};
    u.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  } catch {
    return {};
  }
}

// Parametreleri farklı sırada URL'e ekle
function buildUrlWithParams(baseUrl: string, params: Record<string, string>, order: string[]): string {
  try {
    const u = new URL(baseUrl);
    u.search = '';
    order.forEach(key => {
      if (params[key] !== undefined) {
        u.searchParams.set(key, params[key]);
      }
    });
    return u.toString();
  } catch {
    return baseUrl;
  }
}

// Sayfadaki ürün ID'lerini çıkar
function extractProductIds(page: { url: string; links: string[] }): string[] {
  const productIds: string[] = [];

  for (const link of page.links) {
    try {
      const u = new URL(link);
      const path = u.pathname;

      // Ürün URL pattern'larını yakala
      const patterns = [
        /\/([a-z0-9-]+-p-(\d+))/i,      // trendyol: slug-p-12345
        /\/([a-z0-9-]+-pd-(\d+))/i,     // hepsiburada
        /\/p\/([a-z0-9-]+)/i,           // /p/slug
        /\/urun\/([a-z0-9-]+)/i,        // /urun/slug
        /\/product\/([a-z0-9-]+)/i,     // /product/slug
        /\/([a-z0-9-]+)-(\d{5,})/i,     // slug-12345
      ];

      for (const pattern of patterns) {
        const match = path.match(pattern);
        if (match) {
          const id = match[2] || match[1]; // sayısal ID varsa onu al, yoksa slug
          if (!productIds.includes(id)) {
            productIds.push(id);
          }
          break;
        }
      }
    } catch {}
  }

  return productIds;
}

// İki array arasındaki farkı bul
function arrayDiff(a: string[], b: string[]): { onlyInA: string[]; onlyInB: string[] } {
  return {
    onlyInA: a.filter(x => !b.includes(x)),
    onlyInB: b.filter(x => !a.includes(x)),
  };
}

// Tek bir kategori sayfasını test et
export async function testFilterConsistency(categoryUrl: string): Promise<FilterTestResult | null> {
  const params = extractParams(categoryUrl);
  const paramKeys = Object.keys(params);

  // En az 2 parametre olmalı ki sıra değişimi anlamlı olsun
  if (paramKeys.length < 2) return null;

  // Orijinal sıra ve tersine çevrilmiş sıra
  const orderA = [...paramKeys];
  const orderB = [...paramKeys].reverse();

  const urlA = buildUrlWithParams(categoryUrl, params, orderA);
  const urlB = buildUrlWithParams(categoryUrl, params, orderB);

  // Aynı URL'yse test anlamsız
  if (urlA === urlB) return null;

  // Her iki URL'yi crawl et
  const [pageA, pageB] = await Promise.all([
    crawlPage(urlA),
    crawlPage(urlB),
  ]);

  if (!pageA || !pageB) return null;

  // Her iki sayfanın ürünlerini çıkar
  const productsA = extractProductIds(pageA);
  const productsB = extractProductIds(pageB);

  // En az 3 ürün bulunamazsa güvenilir test yapılamaz
  if (productsA.length < 3 || productsB.length < 3) return null;

  const diff = arrayDiff(productsA, productsB);

  // %20'den fazla fark varsa tutarsızlık var say
  const totalUnique = new Set([...productsA, ...productsB]).size;
  const diffCount = diff.onlyInA.length + diff.onlyInB.length;
  const diffRatio = diffCount / totalUnique;
  const isInconsistent = diffRatio > 0.2;

  return {
    categoryUrl,
    params,
    combinations: [
      { url: urlA, productIds: productsA },
      { url: urlB, productIds: productsB },
    ],
    isInconsistent,
    difference: {
      onlyInFirst: diff.onlyInA.slice(0, 10),
      onlyInSecond: diff.onlyInB.slice(0, 10),
    },
  };
}

// Birden fazla kategori sayfasını test et
export async function runFilterConsistencyTests(
  categoryUrls: string[],
  maxTests = 10
): Promise<FilterTestResult[]> {
  const results: FilterTestResult[] = [];

  // Sadece query parametresi olan URL'leri filtrele
  const urlsWithParams = categoryUrls.filter(url => {
    try {
      return new URL(url).searchParams.size >= 2;
    } catch {
      return false;
    }
  });

  const limited = urlsWithParams.slice(0, maxTests);
  console.log(`[FilterTest] ${limited.length} URL test edilecek`);

  for (const url of limited) {
    const result = await testFilterConsistency(url);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, 500));
  }

  return results;
}
