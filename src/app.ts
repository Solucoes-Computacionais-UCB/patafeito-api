import cors from 'cors';
import express from 'express';
import { docsEnabled, env } from './config/env.js';
import { createDocsRouter } from './shared/http/docs.js';
import { identityRouter } from './modules/identity/http/identity.routes.js';
import { petsRouter } from './modules/pets/http/pets.routes.js';
import { tasksRouter } from './modules/tasks/http/tasks.routes.js';
import { focusRouter } from './modules/focus/http/focus.routes.js';
import { inventoryRouter } from './modules/inventory/http/inventory.routes.js';
import { shopRouter } from './modules/shop/http/shop.routes.js';
import { notificationsRouter } from './modules/notifications/http/notifications.routes.js';
import { rewardsRouter } from './modules/rewards/http/rewards.routes.js';
import { syncRouter } from './modules/sync/http/sync.routes.js';
import { pool } from './db/client.js';
import { errorHandler, notFound, requestId } from './shared/http/handlers.js';
import { rateLimit, requestTelemetry, securityHeaders } from './shared/http/security.js';
import { prometheusMetrics } from './shared/observability/metrics.js';
import { AppError } from './shared/errors/app-error.js';

export const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(requestId);
app.use(securityHeaders);
app.use(requestTelemetry);
app.use(express.json({ limit: '100kb' }));
// A documentação fica antes do rate limit: a Swagger UI carrega dezenas de arquivos estáticos.
if (docsEnabled) {
  app.use('/docs', createDocsRouter());
  app.get('/', (_req, res) => res.redirect('/docs'));
}
app.use(rateLimit('general', env.RATE_LIMIT_MAX, env.RATE_LIMIT_WINDOW_MS));
app.get('/health', (_req, res) => res.json({ data: { status: 'ok' } }));
app.get('/ready', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ data: { status: 'ready' } });
  } catch (error) { next(error); }
});
app.get('/metrics', (req, res, next) => {
  if (!env.METRICS_TOKEN || req.header('x-metrics-token') !== env.METRICS_TOKEN) return next(new AppError(404, 'NOT_FOUND', 'Rota não encontrada.'));
  res.type('text/plain').send(prometheusMetrics());
});
app.use('/api/v1/auth', rateLimit('auth', env.AUTH_RATE_LIMIT_MAX, env.RATE_LIMIT_WINDOW_MS), identityRouter);
app.use('/api/v1/pets', petsRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/focus-sessions', focusRouter);
app.use('/api/v1/shop', shopRouter);
app.use('/api/v1/inventory', inventoryRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/rewards', rewardsRouter);
app.use('/api/v1/sync', rateLimit('sync', env.SYNC_RATE_LIMIT_MAX, env.RATE_LIMIT_WINDOW_MS), syncRouter);
app.use(notFound);
app.use(errorHandler);
