import express from 'express';
import dotenv from 'dotenv';
import scanRouter from './routes/scan';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  return next();
});

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug: sitemap testi
app.get('/api/debug/sitemap', async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'url gerekli' });

  try {
    const axios = (await import('axios')).default;
    const origin = new URL(url).origin;
    const results: Record<string, unknown> = {};

    try {
      const r = await axios.get(`${origin}/robots.txt`, {
        timeout: 8000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeaklyBot/1.0)' },
      });
      const sitemapLines = String(r.data).split('\n').filter(l => l.toLowerCase().includes('sitemap'));
      results['robots.txt'] = { status: r.status, sitemapLines };
    } catch (e) {
      results['robots.txt'] = { error: e instanceof Error ? e.message : String(e) };
    }

    try {
      const r = await axios.get(`${origin}/sitemap.xml`, {
        timeout: 8000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeaklyBot/1.0)' },
      });
      results['sitemap.xml'] = {
        status: r.status,
        contentType: r.headers['content-type'],
        length: String(r.data).length,
        preview: String(r.data).slice(0, 500),
      };
    } catch (e) {
      results['sitemap.xml'] = { error: e instanceof Error ? e.message : String(e) };
    }

    return res.json(results);
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Debug: filtre tutarlilik testi
app.get('/api/debug/filter-test', async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'url gerekli' });

  try {
    const { testFilterConsistency } = await import('./tests/filter-consistency');
    const result = await testFilterConsistency(url);
    return res.json(result ?? { message: 'Test yapilamadi -- yetersiz parametre veya urun' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.use('/api/scans', scanRouter);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Sunucu hatasi.' });
});

app.listen(PORT, () => {
  console.log(`Backend calisiyor: http://localhost:${PORT}`);
});
