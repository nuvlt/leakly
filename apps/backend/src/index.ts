import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import scanRouter from './routes/scan';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.options('*', cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/scans', scanRouter);

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
);

app.listen(PORT, () => {
  console.log(`🚀 Backend çalışıyor: http://localhost:${PORT}`);
});
