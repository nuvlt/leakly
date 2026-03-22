import { Router, Request, Response } from 'express';
import { pool } from '../db/connection';
import { discoverPages } from '../crawler';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url alanı zorunludur.' });
  }

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Geçerli bir URL giriniz.' });
  }

  const scanResult = await pool.query(
    `INSERT INTO scans (url, status, started_at)
     VALUES ($1, 'running', NOW()) RETURNING *`,
    [url]
  );
  const scan = scanResult.rows[0];

  runScan(scan.id, url).catch(err => {
    console.error(`Scan ${scan.id} failed:`, err);
    pool.query(
      `UPDATE scans SET status = 'failed', finished_at = NOW() WHERE id = $1`,
      [scan.id]
    );
  });

  return res.status(202).json({
    scan_id: scan.id,
    status: 'running',
    message: "Scan başlatıldı. Sonuçlar için GET /api/scans/:id kullanın.",
  });
});

router.get('/:id/progress', async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query(
    `SELECT id, url, status, pages_found, current_url, crawler_mode, started_at
     FROM scans WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Scan bulunamadı.' });
  }
  return res.json(result.rows[0]);
});

router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const scanResult = await pool.query('SELECT * FROM scans WHERE id = $1', [id]);
  if (scanResult.rows.length === 0) {
    return res.status(404).json({ error: 'Scan bulunamadı.' });
  }

  const pagesResult = await pool.query(
    'SELECT * FROM pages WHERE scan_id = $1 ORDER BY crawled_at',
    [id]
  );
  const issuesResult = await pool.query(
    'SELECT * FROM issues WHERE scan_id = $1 ORDER BY severity DESC, created_at',
    [id]
  );

  const issues = issuesResult.rows;
  const summary = {
    total_pages: pagesResult.rows.length,
    total_issues: issues.length,
    by_severity: {
      high: issues.filter(i => i.severity === 'high').length,
      medium: issues.filter(i => i.severity === 'medium').length,
      low: issues.filter(i => i.severity === 'low').length,
    },
    by_type: {
      broken_link: issues.filter(i => i.type === 'broken_link').length,
      filter_inconsistency: issues.filter(i => i.type === 'filter_inconsistency').length,
      search_quality: issues.filter(i => i.type === 'search_quality').length,
      listing_problem: issues.filter(i => i.type === 'listing_problem').length,
    },
  };

  return res.json({ scan: scanResult.rows[0], pages: pagesResult.rows, issues, summary });
});

router.get('/', async (_req: Request, res: Response) => {
  const result = await pool.query(
    'SELECT * FROM scans ORDER BY created_at DESC LIMIT 20'
  );
  return res.json(result.rows);
});

async function runScan(scanId: string, url: string) {
  console.log(`[Scan ${scanId}] Başlıyor: ${url}`);

  const { pages, mode } = await discoverPages(url, {
    maxPages: 200,
    maxDepth: 3,
    onProgress: async (currentUrl, count) => {
      await pool.query(
        `UPDATE scans SET pages_found = $1, current_url = $2, crawler_mode = $3 WHERE id = $4`,
        [count, currentUrl, mode, scanId]
      ).catch(() => {});
    },
  });

  for (const page of pages) {
    const pageResult = await pool.query(
      `INSERT INTO pages (scan_id, url, type, status_code)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [scanId, page.url, page.type, page.statusCode]
    );
    const pageId = pageResult.rows[0]?.id;

    if (page.statusCode === 404 || page.statusCode === 500) {
      await pool.query(
        `INSERT INTO issues (scan_id, page_id, type, severity, description, repro_steps, metadata)
         VALUES ($1, $2, 'broken_link', $3, $4, $5, $6)`,
        [
          scanId,
          pageId,
          page.statusCode === 500 ? 'high' : 'medium',
          `${page.statusCode} hatası dönen sayfa tespit edildi.`,
          JSON.stringify([
            `${url} adresini ziyaret et`,
            `${page.url} linkine tıkla`,
            `${page.statusCode} hata sayfası görüntülenir`,
          ]),
          JSON.stringify({ status_code: page.statusCode, affected_url: page.url }),
        ]
      );
    }
  }

  await pool.query(
    `UPDATE scans SET status = 'completed', finished_at = NOW(),
     pages_found = $2, current_url = NULL WHERE id = $1`,
    [scanId, pages.length]
  );

  console.log(`[Scan ${scanId}] Tamamlandı. ${pages.length} sayfa (mod: ${mode})`);
}

export default router;
