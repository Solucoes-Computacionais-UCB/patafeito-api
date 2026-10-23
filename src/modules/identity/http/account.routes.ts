import argon2 from 'argon2';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { activeBoosts } from '../../../db/schema/active-boosts.js';
import { focusSessions } from '../../../db/schema/focus-sessions.js';
import { inventory } from '../../../db/schema/inventory.js';
import { notifications } from '../../../db/schema/notifications.js';
import { pets } from '../../../db/schema/pets.js';
import { refreshTokens } from '../../../db/schema/refresh-tokens.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { tasks } from '../../../db/schema/tasks.js';
import { users } from '../../../db/schema/users.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';
import { issueTokens } from './identity.routes.js';

const password = z.string().min(8).max(128);
const updateProfileInput = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().optional(),
  currentPassword: z.string().optional(),
}).refine((input) => input.displayName !== undefined || input.email !== undefined, 'Informe nome ou e-mail para atualizar.');
const changePasswordInput = z.object({ currentPassword: z.string(), newPassword: password });
const resetProgressInput = z.object({ currentPassword: z.string() });

const publicUser = { id: users.id, email: users.email, displayName: users.displayName };

export const accountRouter = Router();
accountRouter.use(requireAuth);

/** 403, e não 401: o app trata 401 como sessão expirada e tentaria renovar o token. */
async function verifyPassword(userId: string, candidate: string | undefined) {
  const user = await db.query.users.findFirst({ where: and(eq(users.id, userId), isNull(users.deletedAt)) });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Conta não encontrada.');
  if (!candidate || !(await argon2.verify(user.passwordHash, candidate))) throw new AppError(403, 'INVALID_PASSWORD', 'Senha atual incorreta.');
  return user;
}

accountRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const [user] = await db.select(publicUser).from(users).where(and(eq(users.id, req.userId!), isNull(users.deletedAt)));
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Conta não encontrada.');
  res.json({ data: user });
});

/** Trocar o nome é livre; trocar o e-mail, que é o login, pede a senha atual. */
accountRouter.patch('/', async (req: AuthenticatedRequest, res) => {
  const input = updateProfileInput.parse(req.body);
  const userId = req.userId!;
  const current = await db.query.users.findFirst({ where: and(eq(users.id, userId), isNull(users.deletedAt)) });
  if (!current) throw new AppError(404, 'USER_NOT_FOUND', 'Conta não encontrada.');
  const emailChanged = input.email !== undefined && input.email !== current.email;
  if (emailChanged) {
    await verifyPassword(userId, input.currentPassword);
    const taken = await db.query.users.findFirst({ where: and(eq(users.email, input.email!), ne(users.id, userId)) });
    if (taken) throw new AppError(409, 'EMAIL_IN_USE', 'Este e-mail já está em uso.');
  }
  const [user] = await db.update(users).set({
    displayName: input.displayName,
    email: emailChanged ? input.email : undefined,
  }).where(eq(users.id, userId)).returning(publicUser);
  res.json({ data: user });
});

/** Troca a senha, encerra as sessões dos outros aparelhos e devolve tokens novos para este. */
accountRouter.post('/password', async (req: AuthenticatedRequest, res) => {
  const input = changePasswordInput.parse(req.body);
  const userId = req.userId!;
  await verifyPassword(userId, input.currentPassword);
  const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
  const tokens = await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    return issueTokens(userId, tx);
  });
  res.json({ data: { tokens } });
});

/**
 * Zera XP, nível, moedas, inventário, poderes ativos, ciclos de foco, notificações e tarefas concluídas.
 * O pet (nome e espécie) e as tarefas pendentes continuam.
 */
accountRouter.post('/reset-progress', async (req: AuthenticatedRequest, res) => {
  const { currentPassword } = resetProgressInput.parse(req.body);
  const userId = req.userId!;
  await verifyPassword(userId, currentPassword);
  const pet = await db.transaction(async (tx) => {
    // Serializa com compras, alimentação e estornos do mesmo usuário.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    await tx.delete(rewardLedger).where(eq(rewardLedger.userId, userId));
    await tx.delete(inventory).where(eq(inventory.userId, userId));
    await tx.delete(activeBoosts).where(eq(activeBoosts.userId, userId));
    await tx.delete(focusSessions).where(eq(focusSessions.userId, userId));
    await tx.delete(notifications).where(eq(notifications.userId, userId));

    const now = new Date();
    const removed = await tx.update(tasks).set({ deletedAt: now, updatedAt: now, version: sql`${tasks.version} + 1` })
      .where(and(eq(tasks.userId, userId), eq(tasks.status, 'completed'), isNull(tasks.deletedAt))).returning();
    for (const task of removed) {
      await recordSyncChange(tx, { userId, entityType: 'task', entityId: task.id, changeType: 'delete', version: task.version, data: { id: task.id, deletedAt: now.toISOString() } });
    }

    const [resetPet] = await tx.update(pets).set({
      level: 1, xpTotal: 0, hunger: 100, energy: 100, happiness: 100, statsUpdatedAt: now, version: sql`${pets.version} + 1`,
    }).where(eq(pets.userId, userId)).returning();
    if (resetPet) await recordSyncChange(tx, { userId, entityType: 'pet', entityId: resetPet.id, changeType: 'upsert', version: resetPet.version, data: resetPet });
    return resetPet ?? null;
  });
  res.json({ data: { pet } });
});
