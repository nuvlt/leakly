import { pool } from './connection';

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        url         TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        started_at  TIMESTAMP,
        finished_at TIMESTAMP,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pages (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scan_id     UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
        url         TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'unknown',
        status_code INTEGER,
        crawled_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS issues (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scan_id     UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
        page_id     UUID REFERENCES pages(id) ON DELETE SET NULL,
        type        TEXT NOT NULL,
        severity    TEXT NOT NULL,
        description TEXT NOT NULL,
        repro_steps JSONB NOT NULL DEFAULT '[]',
        metadata    JSONB NOT NULL DEFAULT '{}',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pages_scan_id ON pages(scan_id);
      CREATE INDEX IF NOT EXISTS idx_issues_scan_id ON issues(scan_id);
      CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(type);
      CREATE INDEX IF NOT EXISTS idx_issues_severity ON issues(severity);
    `);

    await client.query('COMMIT');
    console.log('✅ Migration tamamlandı.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration başarısız:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

// v2 migration
await client.query(`
  ALTER TABLE scans
    ADD COLUMN IF NOT EXISTS pages_found  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS current_url  TEXT,
    ADD COLUMN IF NOT EXISTS crawler_mode TEXT NOT NULL DEFAULT 'html'
`);
```

Yani `migrate.ts`'deki index'leri oluşturan `await client.query(...)` bloğundan hemen sonra, `COMMIT`'ten önce bu satırları ekle. Commit'le.

Sonra Railway → Settings → Start Command'ı geçici olarak şuna değiştir:
```
npm run migrate --workspace=apps/backend
```

Deploy et, log'da `✅ Migration tamamlandı` görününce eski start command'a geri al:
```
npm run start --workspace=apps/backend
