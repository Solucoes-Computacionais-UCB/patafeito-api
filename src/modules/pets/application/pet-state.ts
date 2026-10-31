import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { pets } from '../../../db/schema/pets.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { tasks } from '../../../db/schema/tasks.js';
import { users } from '../../../db/schema/users.js';
import { dayBounds, localDateKey } from '../../../shared/time/zoned.js';
import { notify } from '../../notifications/application/notify.js';
import { streakFor } from '../../rewards/application/streak.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';
import { decayStats, nextStats } from '../domain/stats.js';
import { INACTIVITY_PENALTY, OVERDUE_PENALTY, moodFor, pendingInactivityWindows, type DailyGoal, type Mood } from '../domain/mood.js';

type Pet = typeof pets.$inferSelect;

/**
 * Aplica as penalidades pendentes ao pet: tarefas que venceram sem conclusão (RN02) e janelas de
 * 24h sem atividade (RN11). Cada tarefa e cada janela é punida uma vez só, então pode ser chamada
 * a cada leitura; a rotina agendada (fase 4) chama a mesma função para quem não abre o app.
 */
export async function refreshPetState(tx: Transaction, userId: string, now = new Date()): Promise<Pet | undefined> {
  const [pet] = await tx.select().from(pets).where(eq(pets.userId, userId)).for('update');
  if (!pet) return undefined;

  const overdue = await tx.select({ id: tasks.id, title: tasks.title }).from(tasks).where(and(
    eq(tasks.userId, userId), eq(tasks.status, 'pending'), isNull(tasks.deletedAt), isNull(tasks.overdueProcessedAt), lt(tasks.dueAt, now),
  ));
  const windows = pendingInactivityWindows(pet.lastActivityAt ?? pet.createdAt, pet.inactivityPenalizedAt, now);
  if (!overdue.length && !windows) return pet;

  if (overdue.length) {
    await tx.update(tasks).set({ overdueProcessedAt: now }).where(inArray(tasks.id, overdue.map((task) => task.id)));
  }
  const happinessLoss = overdue.length * OVERDUE_PENALTY + windows * INACTIVITY_PENALTY;
  const [updated] = await tx.update(pets).set({
    ...nextStats(pet, now, { happiness: -happinessLoss }),
    overdueStreak: pet.overdueStreak + overdue.length,
    inactivityPenalizedAt: windows ? now : pet.inactivityPenalizedAt,
    version: sql`${pets.version} + 1`,
  }).where(eq(pets.id, pet.id)).returning();
  await recordSyncChange(tx, { userId, entityType: 'pet', entityId: updated.id, changeType: 'upsert', version: updated.version, data: updated });

  for (const task of overdue) {
    await notify(tx, {
      userId, type: 'task_overdue', title: 'Tarefa vencida', body: `“${task.title}” venceu. ${updated.name} ficou chateado: reagende ou exclua.`,
      data: { taskId: task.id }, dedupeKey: `task_overdue:${task.id}:${now.toISOString().slice(0, 10)}`,
    });
  }
  if (windows) {
    await notify(tx, {
      userId, type: 'pet_lonely', title: `${updated.name} sente sua falta`, body: 'Faz mais de um dia sem tarefas nem foco. Uma tarefa pequena já anima o pato.',
      dedupeKey: `pet_lonely:${localDateKey(now)}`,
    });
  }
  return updated;
}

/** Campos do pet a gravar quando uma tarefa no prazo ou um ciclo de foco é concluído. */
export function activityFields(at: Date, options: { onTimeTask?: boolean } = {}) {
  return {
    lastActivityAt: at,
    inactivityPenalizedAt: null,
    // RN02: uma conclusão no prazo interrompe a sequência de vencidas.
    ...(options.onTimeTask ? { overdueStreak: 0 } : {}),
  };
}

/**
 * RN08: replanejar uma tarefa vencida zera o contador de vencidas e libera a tarefa para ser
 * punida de novo se vencer outra vez.
 */
export async function resetOverdueOnReschedule(tx: Transaction, userId: string, taskId: string) {
  await tx.update(tasks).set({ overdueProcessedAt: null }).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  const [updated] = await tx.update(pets).set({ overdueStreak: 0, version: sql`${pets.version} + 1` })
    .where(and(eq(pets.userId, userId), sql`${pets.overdueStreak} > 0`)).returning();
  if (updated) await recordSyncChange(tx, { userId, entityType: 'pet', entityId: updated.id, changeType: 'upsert', version: updated.version, data: updated });
}

/** RN13: XP de tarefas ganho hoje (no fuso do usuário) contra a meta diária. */
export async function dailyGoalProgress(tx: Transaction, userId: string, now = new Date()): Promise<DailyGoal> {
  const [user] = await tx.select({ targetXp: users.dailyGoalXp, timezone: users.timezone }).from(users).where(eq(users.id, userId));
  const { start, end } = dayBounds(now, user?.timezone);
  const [row] = await tx.select({ earned: sql<string>`coalesce(sum(${rewardLedger.xpDelta}), 0)` }).from(rewardLedger).where(and(
    eq(rewardLedger.userId, userId), eq(rewardLedger.sourceType, 'task_completion'), gte(rewardLedger.occurredAt, start), lt(rewardLedger.occurredAt, end),
  ));
  return { targetXp: user?.targetXp ?? 60, earnedXp: Number(row.earned) };
}

export type PetView = Pet & { mood: Mood; dailyGoal: DailyGoal; streak: number };

/** Pet como o app o exibe: status decaídos até agora, humor, progresso da meta do dia e sequência (RN07). */
export async function petView(tx: Transaction, pet: Pet, now = new Date()): Promise<PetView> {
  const stats = decayStats(pet, now);
  const dailyGoal = await dailyGoalProgress(tx, pet.userId, now);
  return { ...pet, ...stats, dailyGoal, streak: await streakFor(tx, pet.userId, now), mood: moodFor({ ...stats, overdueStreak: pet.overdueStreak, lastActivityAt: pet.lastActivityAt, createdAt: pet.createdAt }, now, dailyGoal) };
}
