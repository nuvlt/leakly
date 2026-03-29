import puppeteerCore from 'puppeteer-core';

export interface PuppeteerPage {
  url: string;
  statusCode: number;
  type: 'category' | 'search' | 'product' | 'unknown';
  links: string[];
  title: string;
}

function classifyUrl(url: string): PuppeteerPage['type'] {
  const lower = url.toLowerCase();
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return lower; } })();
  const segments = path.split('/').filter(Boolean);

  if (
    lower.includes('/search') || lower.includes('?q=') ||
    lower.includes('?s=') || lower.includes('/ara') ||
    lower.includes('?query=') || lower.includes('?keyword=')
  ) return 'search';

  if (
    lower.includes('/product/') || lower.includes('/urun/') ||
    lower.includes('/p/') || lower.includes('/item/') ||
    lower.includes('/dp/') || lower.includes('/sku/') ||
    /\/[a-z0-9-]+-p-\d+/.test(lower) ||
    /\/[a-z0-9-]+-pd-\d+/.test(lower) ||
    /\/\d{5,}$/.test(path) ||
    segments.some(s => /^[a-z0-9-]+-\d{4,}$/.test(s))
  ) return 'product';

  if (
    lower.includes('/category/') || lower.includes('/kategori/') ||
    lower.includes('/collections/') || lower.includes('/collection/') ||
    lower.includes('/cat/') || lower.includes('/c/') ||
    lower.includes('/shop/') || lower.includes('/magaza/') ||
    /\/(kadin|erkek|cocuk|bebek)(\/|$|-)/i.test(path) ||
    /\/(women|men|kids|baby)(\/|$|-)/i.test(path) ||
    segments.some(s => [
      'gomlek', 'pantolon', 'elbise', 'ayakkabi', 'canta', 'aksesuar',
      'tisort', 'kazak', 'mont', 'ceket', 'etek', 'sort', 'tayt',
      'shirts', 'pants', 'dresses', 'shoes', 'bags', 'accessories',
      'jackets', 'coats', 'sweaters', 'skirts', 'tops', 'jeans',
    ].includes(s))
  ) return 'category';

  return 'unknown';
}

async function getBrowserExecutablePath(): Promise<string> {
  try {
    const chromium = await import('@sparticuz/chromium');
    const execPath = await chromium.default.executablePath();
    return execPath;
  } catch {
    const fsMod = await import('fs');
    const paths = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ];
    for (const p of paths) {
      if (fsMod.existsSync(p)) return p;
    }
    throw new Error('Chrome/Chromium bulunamadi');
  }
}

export async function crawlPageWithPuppeteer(url: string): Promise<PuppeteerPage | null> {
  let browser = null;

  try {
    const executablePath = await getBrowserExecutablePath();

    browser = await puppeteerCore.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    let statusCode = 200;
    page.on('response', (response: { url: () => string; status: () => number }) => {
      if (response.url() === url) {
        statusCode = response.status();
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    const title = await page.title();

    const safeUrl = url.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const links: string[] = await page.evaluate(
      `(function(baseUrl) {
        var anchors = Array.from(document.querySelectorAll('a[href]'));
        var origin = new URL(baseUrl).origin;
        var seen = {};
        var result = [];
        for (var i = 0; i < anchors.length; i++) {
          try {
            var href = anchors[i].href;
            if (!href) continue;
            var u = new URL(href);
            if (u.origin !== origin) continue;
            if (u.pathname.match(/\\.(jpg|jpeg|png|gif|svg|webp|css|js|ico|pdf|zip)$/i)) continue;
            u.hash = '';
            var norm = u.toString();
            if (!seen[norm]) { seen[norm] = true; result.push(norm); }
          } catch(e) {}
        }
        return result;
      })('${safeUrl}')`
    ) as string[];

    return { url, statusCode, type: classifyUrl(url), links, title };
  } catch (err) {
    console.error(`[Puppeteer] Crawl error ${url}:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (browser) {
      try { await (browser as { close: () => Promise<void> }).close(); } catch {}
    }
  }
}

export async function crawlPagesWithPuppeteer(
  urls: string[],
  onProgress?: (url: string, count: number) => void
): Promise<PuppeteerPage[]> {
  const results: PuppeteerPage[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    onProgress?.(url, i + 1);
    console.log(`[Puppeteer] Taraniyor (${i + 1}/${urls.length}): ${url}`);
    const page = await crawlPageWithPuppeteer(url);
    if (page) results.push(page);
    await new Promise(r => setTimeout(r, 500));
  }
  return results;
}
