import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';

// BIGINT columns (lead_number, COUNT(*)) are safely below 2^53, so expose them
// as JS numbers instead of strings. UUIDs and text stay untouched.
const PG_INT8_OID = 20;
types.setTypeParser(PG_INT8_OID, (value: string) => Number.parseInt(value, 10));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'kotalabs-crm',
});

pool.on('error', (error) => {
  logger.error({ err: error }, 'Unexpected error on idle PostgreSQL client');
});

/** Anything that can execute a query: the pool itself or a transaction client. */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

/**
 * Run a query and return all rows.
 */
export async function many<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Queryable = pool,
): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
}

/**
 * Run a query and return the first row, or null.
 */
export async function maybeOne<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Queryable = pool,
): Promise<T | null> {
  const result = await db.query<T>(sql, params);
  return result.rows[0] ?? null;
}

/**
 * Run a query that must return exactly one row. Throws if the row is missing,
 * which indicates a broken invariant rather than a user error — callers should
 * therefore check for existence first when a 404 is the correct response.
 */
export async function one<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Queryable = pool,
): Promise<T> {
  const row = await maybeOne<T>(sql, params, db);
  if (!row) {
    throw new Error(`Expected exactly one row but found none. SQL: ${sql.trim().slice(0, 120)}`);
  }
  return row;
}

/**
 * Execute `fn` inside a transaction. Rolls back on any thrown error.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, 'Failed to roll back transaction');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
