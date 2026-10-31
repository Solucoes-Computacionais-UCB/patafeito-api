import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { notifications } from '../../../db/schema/notifications.js';
import { pets } from '../../../db/schema/pets.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { tasks } from '../../../db/schema/tasks.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { boostedRewards } from '../../inventory/application/boosts.js';
import { activityFields, refreshPetState } from '../../pets/application/pet-state.js';
import { levelForXp } from '../../pets/domain/progression.js';
import { awardStreakBonus, type StreakBonus } from '../../rewards/application/streak.js';
import { nextStats, taskBoost } from '../../pets/domain/stats.js';
import { taskCoins, taskXp, type Difficulty } from '../../rewards/domain/rewards.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';

export type TaskCompletionResult = {
  task: typeof tasks.$inferSelect;
  /** `rareInteraction`: tarefa especial, que não rende XP e destrava uma reação rara do pet (RN14). */
  rewards: { xp: number; coins: number; rareInteraction?: boolean; streakBonus?: StreakBonus };
  pet: typeof pets.$inferSelect;
};

export function isOverdue(task: { dueAt: Date | null }) {
  return task.dueAt !== null && task.dueAt.getTime() < Date.now();
}

/** Conclui a tarefa, credita recompensas e registra as mudanças de sync. A idempotência é responsabilidade de quem chama. */
export async function completeTask(tx: Transaction, input: { userId: string; taskId: string; completedAt: Date }): Promise<TaskCompletionResult> {
  const { userId, taskId, completedAt } = input;
  const task = await tx.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)) });
  if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Tarefa não encontrada.');
  // Penalidades pendentes entram antes: a conclusão no prazo zera a sequência de vencidas daqui em diante.
  const pet = await refreshPetState(tx, userId);
  if (!pet) throw new AppError(409, 'PET_REQUIRED', 'Crie um pet antes de concluir tarefas.');
  if (task.status !== 'pending') throw new AppError(409, 'TASK_NOT_PENDING', 'Esta tarefa já foi concluída.');
  if (isOverdue(task)) throw new AppError(409, 'TASK_OVERDUE', 'Uma tarefa vencida não pode ser concluída.');

  const [completedTask] = await tx.update(tasks).set({ status: 'completed', completedAt, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
    .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId), eq(tasks.status, 'pending'))).returning();
  if (!completedTask) throw new AppError(409, 'TASK_NOT_PENDING', 'Esta tarefa já foi concluída.');

  const special = task.kind === 'special';
  // Especiais ficam fora da economia: lançamento zerado mantém a conclusão idempotente sem consumir poderes.
  const { xp, coins } = special ? { xp: 0, coins: 0 }
    : await boostedRewards(tx, userId, completedAt, { xp: taskXp(task.difficulty as Difficulty), coins: taskCoins(task.difficulty as Difficulty) }, 'task');
  await tx.insert(rewardLedger).values({ userId, sourceType: 'task_completion', sourceId: task.id, xpDelta: xp, coinDelta: coins });
  const xpTotal = pet.xpTotal + xp;
  const [updatedPet] = await tx.update(pets).set({ xpTotal, level: levelForXp(xpTotal), ...nextStats(pet, new Date(), taskBoost(task.difficulty as Difficulty)), ...activityFields(completedAt, { onTimeTask: true }), version: sql`${pets.version} + 1` })
    .where(eq(pets.id, pet.id)).returning();

  await recordSyncChange(tx, { userId, entityType: 'task', entityId: completedTask.id, changeType: 'upsert', version: completedTask.version, data: completedTask });
  await recordSyncChange(tx, { userId, entityType: 'pet', entityId: updatedPet.id, changeType: 'upsert', version: updatedPet.version, data: updatedPet });
  const [notification] = await tx.insert(notifications).values(special
    ? { userId, type: 'special_completed', title: 'Momento especial!', body: `${updatedPet.name} adorou: "${task.title}" foi concluída.`, data: { taskId: task.id } }
    : { userId, type: 'task_completed', title: 'Tarefa concluída!', body: `Você ganhou ${xp} XP e ${coins} moedas.`, data: { taskId: task.id } }).returning();
  await recordSyncChange(tx, { userId, entityType: 'notification', entityId: notification.id, changeType: 'upsert', version: notification.createdAt.toISOString(), data: notification });

  // RN07: a conclusão pode fechar um marco da sequência; o bônus vem em lançamento próprio.
  const streak = await awardStreakBonus(tx, userId, completedAt);
  const rewards = { xp, coins, ...(special ? { rareInteraction: true } : {}), ...(streak.bonus ? { streakBonus: streak.bonus } : {}) };
  return { task: completedTask, rewards, pet: streak.pet ?? updatedPet };
}
