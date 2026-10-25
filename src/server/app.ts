import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env, isProd, isTest } from './env';
import { prisma } from './db';
import { apiRouter } from './routes';
import { dbKeepAlive } from './dbWarmup';
import { loadSession } from './middleware/auth';
import { apiLimiter, csrfProtection } from './middleware/security';
import { errorHandler, notFoundHandler } from './middleware/error';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  const mediaOrigin = env.AWS_ENDPOINT_URL_S3 ? new URL(env.AWS_ENDPOINT_URL_S3).origin : null;
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': ["'self'", 'data:', 'blob:', ...(mediaOrigin ? [mediaOrigin] : [])],
          'connect-src': ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', ...(mediaOrigin ? [mediaOrigin] : [])],
          'worker-src': ["'self'"],
          'manifest-src': ["'self'"],
          'upgrade-insecure-requests': isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Health check is unauthenticated and reveals no secrets.
  app.get('/api/health', async (_req, res) => {
    const started = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'ok', dbLatencyMs: Date.now() - started, uptimeSec: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  // Keep DB connections warm while the app is in use (skipped in tests for deterministic query counts).
  if (!isTest) app.use('/api', dbKeepAlive);
  app.use('/api', apiLimiter, express.json({ limit: '1mb' }), cookieParser(), loadSession, csrfProtection, apiRouter);
  app.use('/api', notFoundHandler);

  // Production: serve the built React app from the same service.
  const clientDir = path.resolve(process.cwd(), 'dist/client');
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    app.use(
      express.static(clientDir, {
        index: false,
        setHeaders: (res, file) => {
          if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
          else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
