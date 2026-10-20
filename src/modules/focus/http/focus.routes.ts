import { and, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { focusSessions } from '../../../db/schema/focus-sessions.js';
import { idempotencyOperations } from '../../../db/schema/idempotency-operations.js';
import { pets } from '../../../db/schema/pets.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { notifications } from '../../../db/schema/notifications.js';
import { levelForXp } from '../../pets/domain/progression.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';

const POMODORO_DURATION_SECONDS = 25 * 60;
const POMODORO_XP = 20;
const POMODORO_COINS = 4;
const idempotencyKey = z.string().uuid();
type CompletionResult = {
  session: typeof focusSessions.$inferSelect;
  rewards: { xp: number; coins: number };
  pet: typeof pets.$inferSelect;
};

function sessionIdParam(value: unknown) {
  return z.string().uuid().parse(value);
}

export const focusRouter = Router();
focusRouter.use(requireAuth);

focusRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const [session] = await db.insert(focusSessions).values({
    userId: req.userId!,
    durationSeconds: POMODORO_DURATION_SECONDS,
  }).returning();
  res.status(201).json({ data: session });
});

focusRouter.post('/:id/finish', async (req: AuthenticatedRequest, res) => {
  const key = idempotencyKey.parse(req.header('idempotency-key'));
  const userId = req.userId!;
  const sessionId = sessionIdParam(req.params.id);
  const result = await db.transaction(async (tx) => {
    const previousOperation = await tx.query.idempotencyOperations.findFirst({
      where: and(eq(idempotencyOperations.userId, userId), eq(idempotencyOperations.key, key)),
    });
    if (previousOperation) {
      if (previousOperation.operation !== 'focus_session_completion' || previousOperation.resourceId !== sessionId) {
        throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'A chave de idempotência já foi usada para outra operação.');
      }
      return previousOperation.response as CompletionResult;
    }

    const session = await tx.query.focusSessions.findFirst({
      where: and(eq(focusSessions.id, sessionId), eq(focusSessions.userId, userId)),
    });
    if (!session) throw new AppError(404, 'FOCUS_SESSION_NOT_FOUND', 'Sessão de foco não encontrada.');
    if (session.status !== 'active') throw new AppError(409, 'FOCUS_SESSION_NOT_ACTIVE', 'Esta sessão de foco já foi finalizada.');
    const finishedAt = new Date();
    if (finishedAt.getTime() - session.startedAt.getTime() < session.durationSeconds * 1000) {
      throw new AppError(409, 'FOCUS_SESSION_INCOMPLETE', 'A sessão Pomodoro ainda não atingiu a duração mínima.');
    }

    const pet = await tx.query.pets.findFirst({ where: eq(pets.userId, userId) });
    if (!pet) throw new AppError(409, 'PET_REQUIRED', 'Crie um pet antes de concluir sessões de foco.');
    const [completedSession] = await tx.update(focusSessions).set({ status: 'completed', finishedAt })
      .where(and(eq(focusSessions.id, session.id), eq(focusSessions.status, 'active'))).returning();
    if (!completedSession) {
      const concurrentOperation = await tx.query.idempotencyOperations.findFirst({
        where: and(eq(idempotencyOperations.userId, userId), eq(idempotencyOperations.key, key)),
      });
      if (concurrentOperation) return concurrentOperation.response as CompletionResult;
      throw new AppError(409, 'FOCUS_SESSION_NOT_ACTIVE', 'Esta sessão de foco já foi finalizada.');
    }
    await tx.insert(rewardLedger).values({
      userId,
      sourceType: 'focus_session_completion',
      sourceId: session.id,
      xpDelta: POMODORO_XP,
      coinDelta: POMODORO_COINS,
    });
    const xpTotal = pet.xpTotal + POMODORO_XP;
    const [updatedPet] = await tx.update(pets).set({
      xpTotal,
      level: levelForXp(xpTotal),
      version: sql`${pets.version} + 1`,
    }).where(eq(pets.id, pet.id)).returning();
    const response: CompletionResult = { session: completedSession, rewards: { xp: POMODORO_XP, coins: POMODORO_COINS }, pet: updatedPet };
    await tx.insert(idempotencyOperations).values({
      userId,
      key,
      operation: 'focus_session_completion',
      resourceId: sessionId,
      response,
    });
    const [notification] = await tx.insert(notifications).values({ userId, type: 'focus_completed', title: 'Foco concluído!', body: `Você ganhou ${POMODORO_XP} XP e ${POMODORO_COINS} moedas.`, data: { sessionId: session.id } }).returning();
    await recordSyncChange(tx, { userId, entityType: 'pet', entityId: updatedPet.id, changeType: 'upsert', version: updatedPet.version, data: updatedPet });
    await recordSyncChange(tx, { userId, entityType: 'notification', entityId: notification.id, changeType: 'upsert', version: notification.createdAt.toISOString(), data: notification });
    return response;
  });
  res.json({ data: result });
});
