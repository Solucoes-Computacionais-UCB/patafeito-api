import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { focusSessions } from '../../../db/schema/focus-sessions.js';
import { notifications } from '../../../db/schema/notifications.js';
import { pets } from '../../../db/schema/pets.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { tasks } from '../../../db/schema/tasks.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { boostedRewards } from '../../inventory/application/boosts.js';
import { activityFields } from '../../pets/application/pet-state.js';
import { levelForXp } from '../../pets/domain/progression.js';
import { FOCUS_BOOST, nextStats } from '../../pets/domain/stats.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';

export const POMODORO_DURATION_SECONDS = 25 * 60;
export const POMODORO_XP = 20;
export const POMODORO_COINS = 5;
/** Limites de um ciclo personalizado. */
export const MIN_FOCUS_SECONDS = 5 * 60;
export const MAX_FOCUS_SECONDS = 120 * 60;
export const FOCUS_MODES = ['pomodoro', 'deep_work', 'sprint', 'custom'] as const;
export type FocusMode = typeof FOCUS_MODES[number];

/** Só guarda o vínculo com tarefas da própria pessoa; uma tarefa desconhecida não invalida o foco. */
export async function ownedTaskId(tx: Transaction, userId: string, taskId: string | null | undefined) {
  if (!taskId) return null;
  const task = await tx.query.tasks.findFirst({ columns: { id: true }, where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)) });
  return task?.id ?? null;
}

/** Recompensa proporcional à duração: o ciclo clássico de 25 minutos vale 20 XP e 5 moedas. */
export function focusRewards(durationSeconds: number) {
  const ratio = durationSeconds / POMODORO_DURATION_SECONDS;
  return { xp: Math.round(POMODORO_XP * ratio), coins: Math.round(POMODORO_COINS * ratio) };
}

export type FocusCompletionResult = {
  session: typeof focusSessions.$inferSelect;
  rewards: { xp: number; coins: number };
  pet: typeof pets.$inferSelect;
};

/** Um Pomodoro só vale recompensa quando o tempo decorrido cobre a duração-alvo. */
export function isFullPomodoro(startedAt: Date, finishedAt: Date, durationSeconds = POMODORO_DURATION_SECONDS) {
  return finishedAt.getTime() - startedAt.getTime() >= durationSeconds * 1000;
}

async function award(tx: Transaction, userId: string, session: typeof focusSessions.$inferSelect): Promise<FocusCompletionResult> {
  const pet = await tx.query.pets.findFirst({ where: eq(pets.userId, userId) });
  if (!pet) throw new AppError(409, 'PET_REQUIRED', 'Crie um pet antes de concluir sessões de foco.');
  const { xp, coins } = await boostedRewards(tx, userId, session.finishedAt ?? new Date(), focusRewards(session.durationSeconds), 'focus');
  await tx.insert(rewardLedger).values({ userId, sourceType: 'focus_session_completion', sourceId: session.id, xpDelta: xp, coinDelta: coins });
  const xpTotal = pet.xpTotal + xp;
  const [updatedPet] = await tx.update(pets).set({ xpTotal, level: levelForXp(xpTotal), ...nextStats(pet, new Date(), FOCUS_BOOST), ...activityFields(session.finishedAt ?? new Date()), version: sql`${pets.version} + 1` }).where(eq(pets.id, pet.id)).returning();
  const [notification] = await tx.insert(notifications).values({ userId, type: 'focus_completed', title: 'Foco concluído!', body: `Você ganhou ${xp} XP e ${coins} moedas.`, data: { sessionId: session.id } }).returning();
  await recordSyncChange(tx, { userId, entityType: 'pet', entityId: updatedPet.id, changeType: 'upsert', version: updatedPet.version, data: updatedPet });
  await recordSyncChange(tx, { userId, entityType: 'notification', entityId: notification.id, changeType: 'upsert', version: notification.createdAt.toISOString(), data: notification });
  return { session, rewards: { xp, coins }, pet: updatedPet };
}

/** Finaliza uma sessão iniciada no servidor (fluxo online). */
export async function finishFocusSession(tx: Transaction, input: { userId: string; sessionId: string; finishedAt: Date }): Promise<FocusCompletionResult> {
  const { userId, sessionId, finishedAt } = input;
  const session = await tx.query.focusSessions.findFirst({ where: and(eq(focusSessions.id, sessionId), eq(focusSessions.userId, userId)) });
  if (!session) throw new AppError(404, 'FOCUS_SESSION_NOT_FOUND', 'Sessão de foco não encontrada.');
  if (session.status !== 'active') throw new AppError(409, 'FOCUS_SESSION_NOT_ACTIVE', 'Esta sessão de foco já foi finalizada.');
  if (!isFullPomodoro(session.startedAt, finishedAt, session.durationSeconds)) throw new AppError(409, 'FOCUS_SESSION_INCOMPLETE', 'A sessão Pomodoro ainda não atingiu a duração mínima.');
  const [completedSession] = await tx.update(focusSessions).set({ status: 'completed', finishedAt })
    .where(and(eq(focusSessions.id, session.id), eq(focusSessions.status, 'active'))).returning();
  if (!completedSession) throw new AppError(409, 'FOCUS_SESSION_NOT_ACTIVE', 'Esta sessão de foco já foi finalizada.');
  return award(tx, userId, completedSession);
}

/** Registra uma sessão conduzida offline pelo app, usando o identificador gerado no aparelho. */
export async function recordOfflineFocusSession(tx: Transaction, input: { userId: string; sessionId: string; startedAt: Date; finishedAt: Date; durationSeconds?: number; taskId?: string | null; mode?: FocusMode }): Promise<FocusCompletionResult> {
  const { userId, sessionId, startedAt, finishedAt, durationSeconds = POMODORO_DURATION_SECONDS, mode = 'pomodoro' } = input;
  const now = Date.now();
  if (startedAt.getTime() > now || finishedAt.getTime() > now + 60_000) throw new AppError(409, 'FOCUS_SESSION_INVALID_PERIOD', 'O período informado para a sessão de foco é inválido.');
  if (!isFullPomodoro(startedAt, finishedAt, durationSeconds)) throw new AppError(409, 'FOCUS_SESSION_INCOMPLETE', 'A sessão Pomodoro não atingiu a duração mínima.');
  const [session] = await tx.insert(focusSessions)
    .values({ id: sessionId, userId, status: 'completed', durationSeconds, mode, taskId: await ownedTaskId(tx, userId, input.taskId), startedAt, finishedAt })
    .onConflictDoNothing({ target: focusSessions.id }).returning();
  if (!session) throw new AppError(409, 'FOCUS_SESSION_ALREADY_RECORDED', 'Esta sessão de foco já foi registrada.');
  return award(tx, userId, session);
}
