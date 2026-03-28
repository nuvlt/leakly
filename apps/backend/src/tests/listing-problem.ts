import { crawlPage } from '../crawler';

export interface ListingProblemResult {
  categoryUrl: string;
  productCount: number;
  issue: 'empty_category' | 'thin_category' | null;
  description: string | null;
}

function countProductLinks(links: string[]): number {
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

async function testSingleCategory(url: string): Promise<ListingProblemResult | null> {
  const page = await crawlPage(url);
  if (!page || page.statusCode !== 200) return null;

  const productCount = countProductLinks(page.links);

  let issue: ListingProblemResult['issue'] = null;
  let description: string | null = null;

  if (productCount === 0) {
    issue = 'empty_category';
    description = `Kategori sayfasi bos - hic urun bulunamadi.`;
  } else if (productCount <= 2) {
    issue = 'thin_category';
    description = `Kategori sayfasinda cok az urun var (${productCount} urun). Eksik icerик sorunu olabilir.`;
  }

  return { categoryUrl: url, productCount, issue, description };
}

export async function runListingProblemTests(
  categoryUrls: string[],
  maxTests = 30
): Promise<ListingProblemResult[]> {
  const results: ListingProblemResult[] = [];

  // Sadece parametresiz kategori URL'lerini test et
  const cleanUrls = categoryUrls
    .filter(url => {
      try { return new URL(url).searchParams.size === 0; } catch { return false; }
    })
    .slice(0, maxTests);

  console.log(`[ListingTest] ${cleanUrls.length} kategori sayfasi test edilecek`);

  for (const url of cleanUrls) {
    const result = await testSingleCategory(url);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, 200));
  }

  const issues = results.filter(r => r.issue !== null);
  console.log(`[ListingTest] Tamamlandi. ${issues.length} sorun bulundu.`);

  return results;
}
