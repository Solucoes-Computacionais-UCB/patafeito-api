import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { identityRouter } from './modules/identity/http/identity.routes.js';
import { petsRouter } from './modules/pets/http/pets.routes.js';
import { tasksRouter } from './modules/tasks/http/tasks.routes.js';
import { focusRouter } from './modules/focus/http/focus.routes.js';
import { inventoryRouter } from './modules/inventory/http/inventory.routes.js';
import { shopRouter } from './modules/shop/http/shop.routes.js';
import { notificationsRouter } from './modules/notifications/http/notifications.routes.js';
import { syncRouter } from './modules/sync/http/sync.routes.js';
import { pool } from './db/client.js';
import { errorHandler, notFound, requestId } from './shared/http/handlers.js';

export const app = express();
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: '100kb' }));
app.use(requestId);
app.get('/health', (_req, res) => res.json({ data: { status: 'ok' } }));
app.get('/ready', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ data: { status: 'ready' } });
  } catch (error) { next(error); }
});
app.use('/api/v1/auth', identityRouter);
app.use('/api/v1/pets', petsRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/focus-sessions', focusRouter);
app.use('/api/v1/shop', shopRouter);
app.use('/api/v1/inventory', inventoryRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/sync', syncRouter);
app.use(notFound);
app.use(errorHandler);
