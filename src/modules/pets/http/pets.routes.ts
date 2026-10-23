import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { petCompanions } from '../../../db/schema/pet-companions.js';
import { pets } from '../../../db/schema/pets.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';
import { decayStats } from '../domain/stats.js';

const speciesId = z.string().min(1).max(40);
const petName = z.string().trim().min(2).max(15);

export const petsRouter = Router();
petsRouter.use(requireAuth);
petsRouter.get('/me', async (req: AuthenticatedRequest, res) => {
  const pet = await db.query.pets.findFirst({ where: eq(pets.userId, req.userId!) });
  if (!pet) throw new AppError(404, 'PET_NOT_FOUND', 'Pet ainda não foi criado.');
  // Leitura não grava: devolve os status já decaídos, com `statsUpdatedAt` no instante do cálculo.
  res.json({ data: { ...pet, ...decayStats(pet, new Date()) } });
});
petsRouter.post('/me', async (req: AuthenticatedRequest, res) => {
  const input = z.object({ speciesId, name: petName }).parse(req.body);
  const existing = await db.query.pets.findFirst({ where: eq(pets.userId, req.userId!) });
  if (existing) throw new AppError(409, 'PET_ALREADY_EXISTS', 'O usuário já possui um pet.');
  const pet = await db.transaction(async (tx) => {
    const [created] = await tx.insert(pets).values({ ...input, userId: req.userId! }).returning();
    await tx.insert(petCompanions).values({ userId: created.userId, petId: created.id, speciesId: created.speciesId, name: created.name, startedAt: created.createdAt });
    await recordSyncChange(tx, { userId: req.userId!, entityType: 'pet', entityId: created.id, changeType: 'upsert', version: created.version, data: created });
    return created;
  });
  res.status(201).json({ data: pet });
});

/** Troca o apelido do pato atual; o histórico guarda o novo apelido no período em andamento. */
petsRouter.patch('/me', async (req: AuthenticatedRequest, res) => {
  const { name } = z.object({ name: petName }).parse(req.body);
  const userId = req.userId!;
  const pet = await db.transaction(async (tx) => {
    const [renamed] = await tx.update(pets).set({ name, version: sql`${pets.version} + 1` }).where(eq(pets.userId, userId)).returning();
    if (!renamed) throw new AppError(404, 'PET_NOT_FOUND', 'Pet ainda não foi criado.');
    await tx.update(petCompanions).set({ name }).where(and(eq(petCompanions.petId, renamed.id), isNull(petCompanions.endedAt)));
    await recordSyncChange(tx, { userId, entityType: 'pet', entityId: renamed.id, changeType: 'upsert', version: renamed.version, data: renamed });
    return renamed;
  });
  res.json({ data: pet });
});

/** Troca a espécie do pato. XP, nível e status continuam; o período anterior fica no histórico. */
petsRouter.post('/me/switch', async (req: AuthenticatedRequest, res) => {
  const input = z.object({ speciesId, name: petName }).parse(req.body);
  const userId = req.userId!;
  const pet = await db.transaction(async (tx) => {
    const current = await tx.query.pets.findFirst({ where: eq(pets.userId, userId) });
    if (!current) throw new AppError(404, 'PET_NOT_FOUND', 'Pet ainda não foi criado.');
    if (current.speciesId === input.speciesId) throw new AppError(409, 'SAME_SPECIES', 'Este já é o seu pato atual.');
    const now = new Date();
    await tx.update(petCompanions).set({ endedAt: now }).where(and(eq(petCompanions.petId, current.id), isNull(petCompanions.endedAt)));
    await tx.insert(petCompanions).values({ userId, petId: current.id, speciesId: input.speciesId, name: input.name, startedAt: now });
    const [switched] = await tx.update(pets).set({ speciesId: input.speciesId, name: input.name, version: sql`${pets.version} + 1` })
      .where(eq(pets.id, current.id)).returning();
    await recordSyncChange(tx, { userId, entityType: 'pet', entityId: switched.id, changeType: 'upsert', version: switched.version, data: switched });
    return switched;
  });
  res.json({ data: pet });
});

/** Períodos com cada pato, do mais antigo ao atual (`endedAt` nulo). */
petsRouter.get('/me/history', async (req: AuthenticatedRequest, res) => {
  const periods = await db.select({
    speciesId: petCompanions.speciesId, name: petCompanions.name, startedAt: petCompanions.startedAt, endedAt: petCompanions.endedAt,
  }).from(petCompanions).where(eq(petCompanions.userId, req.userId!)).orderBy(asc(petCompanions.startedAt));
  res.json({ data: periods });
});
