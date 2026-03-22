import { pool } from './connection';

async function migrateV2() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE scans
        ADD COLUMN IF NOT EXISTS pages_found   INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS current_url   TEXT,
        ADD COLUMN IF NOT EXISTS crawler_mode  TEXT NOT NULL DEFAULT 'html'
    `);

    await client.query('COMMIT');
    console.log('✅ Migration v2 tamamlandı.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration v2 başarısız:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateV2();
