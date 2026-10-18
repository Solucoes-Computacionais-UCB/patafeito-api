import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { identityRouter } from './modules/identity/http/identity.routes.js';
import { petsRouter } from './modules/pets/http/pets.routes.js';
import { tasksRouter } from './modules/tasks/http/tasks.routes.js';
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
app.use(notFound);
app.use(errorHandler);
