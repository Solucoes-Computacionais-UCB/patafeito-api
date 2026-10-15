import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { pets } from '../../../db/schema/pets.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';

export const petsRouter = Router();
petsRouter.use(requireAuth);
petsRouter.get('/me', async (req: AuthenticatedRequest, res) => {
  const pet = await db.query.pets.findFirst({ where: eq(pets.userId, req.userId!) });
  if (!pet) throw new AppError(404, 'PET_NOT_FOUND', 'Pet ainda não foi criado.');
  res.json({ data: pet });
});
petsRouter.post('/me', async (req: AuthenticatedRequest, res) => {
  const input = z.object({ speciesId: z.string().min(1).max(40), name: z.string().trim().min(2).max(15) }).parse(req.body);
  const existing = await db.query.pets.findFirst({ where: eq(pets.userId, req.userId!) });
  if (existing) throw new AppError(409, 'PET_ALREADY_EXISTS', 'O usuário já possui um pet.');
  const [pet] = await db.insert(pets).values({ ...input, userId: req.userId! }).returning();
  res.status(201).json({ data: pet });
});
