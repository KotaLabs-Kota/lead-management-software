import pino from 'pino';
import { env, isTest } from '../config/env';

/**
 * Structured JSON logger. In development pipe the output through pino-pretty:
 *   npm run dev | npx pino-pretty
 *
 * Sensitive values are redacted so tokens never land in log files.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'kotalabs-crm-backend' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-device-token"]',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.refreshToken',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
