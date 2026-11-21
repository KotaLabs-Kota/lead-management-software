/**
 * Seed script — creates the initial accounts for the client.
 *
 *   SEED_ADMIN_EMAIL=admin@multanimotors.example
 *   SEED_ADMIN_PASSWORD=<strong password>
 *   SEED_EMPLOYEE_PASSWORD=<shared strong password for the two employees>
 *
 * The script is idempotent: existing accounts are left untouched.
 * Employees are created with the same password for convenience; each employee
 * must change it on first login (POST /api/auth/change-password).
 *
 * Usage:
 *   npm run db:seed
 */
import { Pool } from 'pg';
import { hashPassword } from '../src/utils/password';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    // eslint-disable-next-line no-console
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value.trim();
}

async function upsertUser(
  pool: Pool,
  email: string,
  password: string,
  name: string,
  role: 'ADMIN' | 'EMPLOYEE',
): Promise<'created' | 'exists'> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  if (rows.length > 0) return 'exists';

  const passwordHash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)`,
    [email.toLowerCase(), passwordHash, name, role],
  );
  return 'created';
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const adminEmail = required('SEED_ADMIN_EMAIL');
  const adminPassword = required('SEED_ADMIN_PASSWORD');
  const employeePassword = required('SEED_EMPLOYEE_PASSWORD');

  if (adminPassword.length < 10 || employeePassword.length < 10) {
    // eslint-disable-next-line no-console
    console.error('Seed passwords must be at least 10 characters long.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, application_name: 'kotalabs-crm-seed' });
  try {
    const admin = await upsertUser(pool, adminEmail, adminPassword, 'Admin', 'ADMIN');
    const employee1 = await upsertUser(
      pool,
      'employee1@multanimotors.example',
      employeePassword,
      'Employee 1',
      'EMPLOYEE',
    );
    const employee2 = await upsertUser(
      pool,
      'employee2@multanimotors.example',
      employeePassword,
      'Employee 2',
      'EMPLOYEE',
    );

    // eslint-disable-next-line no-console
    console.log(`Admin:     ${admin}  (${adminEmail})`);
    // eslint-disable-next-line no-console
    console.log(`Employee 1: ${employee1}  (employee1@multanimotors.example)`);
    // eslint-disable-next-line no-console
    console.log(`Employee 2: ${employee2}  (employee2@multanimotors.example)`);
    // eslint-disable-next-line no-console
    console.log('Passwords were taken from the environment and are not printed.');
  } finally {
    await pool.end();
  }
}

main().catch(() => process.exit(1));
