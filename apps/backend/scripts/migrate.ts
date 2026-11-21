/**
 * Database migration runner.
 *
 * Applies every `migrations/*.sql` file (in filename order) that has not been
 * recorded in the `schema_migrations` table. Each file runs inside a single
 * transaction, so a failed migration never leaves a half-applied schema.
 *
 * Usage:
 *   npm run db:migrate
 *   DATABASE_URL=postgres://... npx tsx scripts/migrate.ts
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, application_name: 'kotalabs-crm-migrate' });

  try {
    await ensureMigrationsTable(pool);

    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

    if (files.length === 0) {
      // eslint-disable-next-line no-console
      console.log('No migration files found in', MIGRATIONS_DIR);
      return;
    }

    const { rows: applied } = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations',
    );
    const appliedNames = new Set(applied.map((row) => row.name));

    let appliedCount = 0;
    for (const file of files) {
      if (appliedNames.has(file)) {
        // eslint-disable-next-line no-console
        console.log(`  skip  ${file} (already applied)`);
        continue;
      }

      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        // eslint-disable-next-line no-console
        console.log(`  apply ${file}`);
        appliedCount += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        // eslint-disable-next-line no-console
        console.error(`  FAIL  ${file}:`, error instanceof Error ? error.message : error);
        throw error;
      } finally {
        client.release();
      }
    }

    // eslint-disable-next-line no-console
    console.log(`Done. ${appliedCount} migration(s) applied, ${files.length - appliedCount} already up to date.`);
  } finally {
    await pool.end();
  }
}

main().catch(() => process.exit(1));
