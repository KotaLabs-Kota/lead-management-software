import { randomUUID } from 'node:crypto';
import compression from 'compression';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { corsOrigins, trustProxy } from './config/env';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimit';
import { authRouter } from './modules/auth/auth.routes';
import { callEventsRouter } from './modules/call-events/call-events.routes';
import { callSyncRouter } from './modules/call-sync/call-sync.routes';
import { devicesRouter } from './modules/devices/devices.routes';
import { followupsRouter } from './modules/followups/followups.routes';
import { leadsRouter } from './modules/leads/leads.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { usersRouter } from './modules/users/users.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  // Correlation id for every request, echoed back to the client.
  app.use((req: Request, res: Response, next) => {
    req.requestId = req.header('x-request-id') ?? randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.requestId ?? randomUUID(),
      autoLogging: {
        ignore: (req) => req.url === '/healthz' || req.url === '/api/health',
      },
    }),
  );

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(compression());

  app.use(
    cors({
      origin(origin, callback) {
        // Non-browser clients (Android app, curl, Postman) have no Origin.
        if (!origin) return callback(null, true);
        if (corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
      maxAge: 86400,
    }),
  );

  // 1 MB is plenty for a single lead/call payload; batches are capped at 500
  // events in the schema, so keep the limit tight.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(apiRateLimiter);

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'kotalabs-crm-backend' });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'kotalabs-crm-backend' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/devices', devicesRouter);
  app.use('/api/v1/leads', leadsRouter);
  app.use('/api/v1/call-events', callEventsRouter);
  app.use('/api/v1/call-sync', callSyncRouter);
  app.use('/api/v1/followups', followupsRouter);
  app.use('/api/v1/reports', reportsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
