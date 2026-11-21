import { env } from './config/env';
import { closePool, pool } from './db/pool';
import { logger } from './lib/logger';
import { createApp } from './app';

async function main(): Promise<void> {
  // Fail fast if the database is unreachable instead of serving 500s.
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
  logger.info('PostgreSQL connection verified');

  const app = createApp();

  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `KotaLabs CRM backend listening on http://0.0.0.0:${env.PORT}`,
    );
  });

  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
    // Force-exit if connections refuse to close.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((error) => {
  logger.error({ err: error }, 'Failed to start the server');
  process.exit(1);
});
