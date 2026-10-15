import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { identityRouter } from './modules/identity/http/identity.routes.js';
import { petsRouter } from './modules/pets/http/pets.routes.js';
import { errorHandler, notFound } from './shared/http/handlers.js';

export const app = express();
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: '100kb' }));
app.get('/health', (_req, res) => res.json({ data: { status: 'ok' } }));
app.use('/api/v1/auth', identityRouter);
app.use('/api/v1/pets', petsRouter);
app.use(notFound);
app.use(errorHandler);
