/**
 * Global test setup.
 *
 * Starts a real PostgreSQL instance (embedded-postgres, no Docker needed),
 * runs the migrations, and seeds one admin + two employees. The database URL
 * is injected into the environment BEFORE the app modules are imported.
 */
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

const PORT = 55433;
const USER = 'postgres';
const PASSWORD = 'postgres';
const DATABASE = 'crm_test';

export const TEST_DATABASE_URL = `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`;

let postgres: EmbeddedPostgres | null = null;

async function runMigrations(client: Client): Promise<void> {
  const dir = resolve(__dirname, '..', 'migrations');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');
    await client.query(sql);
  }
}

export async function startTestDatabase(): Promise<void> {
  postgres = new EmbeddedPostgres({
    databaseDir: join(process.cwd(), '.test-pgdata'),
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: false,
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(DATABASE);

  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await runMigrations(client);
  } finally {
    await client.end();
  }
}

export async function stopTestDatabase(): Promise<void> {
  if (postgres) {
    await postgres.stop();
    postgres = null;
  }
}

/** Seed helpers — import the password hasher after env is set. */
export async function seedUsers(): Promise<{
  admin: { id: string; email: string; password: string };
  employee: { id: string; email: string; password: string };
  employee2: { id: string; email: string; password: string };
}> {
  const { hashPassword } = await import('../src/utils/password');
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();

  const insert = async (email: string, password: string, name: string, role: string) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [email, await hashPassword(password), name, role],
    );
    return rows[0]!.id;
  };

  try {
    const admin = {
      id: await insert('admin@test.local', 'AdminPass123!', 'Test Admin', 'ADMIN'),
      email: 'admin@test.local',
      password: 'AdminPass123!',
    };
    const employee = {
      id: await insert('employee@test.local', 'EmployeePass123!', 'Test Employee', 'EMPLOYEE'),
      email: 'employee@test.local',
      password: 'EmployeePass123!',
    };
    const employee2 = {
      id: await insert('employee2@test.local', 'EmployeePass123!', 'Test Employee 2', 'EMPLOYEE'),
      email: 'employee2@test.local',
      password: 'EmployeePass123!',
    };
    return { admin, employee, employee2 };
  } finally {
    await client.end();
  }
}

export function newEventId(): string {
  return randomUUID();
}
