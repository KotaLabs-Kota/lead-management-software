/**
 * Development stack launcher (dev only — never used in production).
 *
 * Starts an embedded PostgreSQL instance, applies migrations, seeds the
 * initial accounts, and serves the API — all in one command, no Docker or
 * local PostgreSQL install required.
 *
 * Usage:
 *   npm run dev:stack
 *
 * Seeded accounts (dev only):
 *   admin@multanimotors.example / AdminPass123!
 *   employee1@multanimotors.example / EmployeePass123!
 *   employee2@multanimotors.example / EmployeePass123!
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

const PG_PORT = 55434;
const USER = 'postgres';
const PASSWORD = 'postgres';
const DATABASE = 'kotalabs_crm';

process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = `postgres://${USER}:${PASSWORD}@localhost:${PG_PORT}/${DATABASE}`;
process.env.JWT_ACCESS_SECRET = 'dev-only-secret-change-me-32-chars-minimum';
process.env.PORT = '4000';
process.env.LOG_LEVEL = 'info';
process.env.CORS_ORIGINS = 'http://localhost:3000';

async function runMigrations(client: Client): Promise<void> {
  const dir = resolve(__dirname, '..', 'migrations');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');
    await client.query(sql);
    // eslint-disable-next-line no-console
    console.log(`  migrated ${file}`);
  }
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Starting embedded PostgreSQL…');
  const postgres = new EmbeddedPostgres({
    databaseDir: join(process.cwd(), '.dev-pgdata'),
    user: USER,
    password: PASSWORD,
    port: PG_PORT,
    persistent: true,
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(DATABASE).catch(() => undefined);
  // eslint-disable-next-line no-console
  console.log(`PostgreSQL ready on port ${PG_PORT}`);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await runMigrations(client);

    const { hashPassword } = await import('../src/utils/password');
    const seed = async (email: string, password: string, name: string, role: string) => {
      const { rows } = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE lower(email) = lower($1)',
        [email],
      );
      if (rows.length > 0) return;
      await client.query(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)`,
        [email, await hashPassword(password), name, role],
      );
      // eslint-disable-next-line no-console
      console.log(`  seeded ${email}`);
    };

    await seed('admin@multanimotors.example', 'AdminPass123!', 'Admin', 'ADMIN');
    await seed('employee1@multanimotors.example', 'EmployeePass123!', 'Employee One', 'EMPLOYEE');
    await seed('employee2@multanimotors.example', 'EmployeePass123!', 'Employee Two', 'EMPLOYEE');
  } finally {
    await client.end();
  }

  const { createApp } = await import('../src/app');
  const app = createApp();
  const server = app.listen(4000, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log('KotaLabs CRM backend listening on http://0.0.0.0:4000');
  });

  const shutdown = () => {
    server.close(() => {
      void postgres.stop().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
