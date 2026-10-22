import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { pets } from '../../../db/schema/pets.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { tasks } from '../../../db/schema/tasks.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { levelForXp } from '../../pets/domain/progression.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';

export type TaskReopenResult = {
  task: typeof tasks.$inferSelect;
  refunded: { xp: number; coins: number };
  pet: typeof pets.$inferSelect;
};

/**
 * Desfaz a conclusão de uma tarefa: a recompensa volta atrás.
 *
 * Em vez de lançar um estorno, os lançamentos da conclusão são removidos do razão.
 * Isso mantém a unicidade de `(source_type, source_id, user_id)` e permite concluir
 * a mesma tarefa de novo depois.
 */
export async function reopenTask(tx: Transaction, input: { userId: string; taskId: string }): Promise<TaskReopenResult> {
  const { userId, taskId } = input;
  // O saldo é lido e alterado aqui: serializa com compras do mesmo usuário.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

  const task = await tx.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)) });
  if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Tarefa não encontrada.');
  if (task.status !== 'completed') throw new AppError(409, 'TASK_NOT_COMPLETED', 'Esta tarefa não está concluída.');
  const pet = await tx.query.pets.findFirst({ where: eq(pets.userId, userId) });
  if (!pet) throw new AppError(409, 'PET_REQUIRED', 'Crie um pet antes de alterar tarefas.');

  const entries = await tx.select({ xpDelta: rewardLedger.xpDelta, coinDelta: rewardLedger.coinDelta }).from(rewardLedger)
    .where(and(eq(rewardLedger.userId, userId), eq(rewardLedger.sourceType, 'task_completion'), eq(rewardLedger.sourceId, task.id)));
  const xp = entries.reduce((total, entry) => total + entry.xpDelta, 0);
  const coins = entries.reduce((total, entry) => total + entry.coinDelta, 0);

  const [balanceRow] = await tx.select({ balance: sql<string>`coalesce(sum(${rewardLedger.coinDelta}), 0)` })
    .from(rewardLedger).where(eq(rewardLedger.userId, userId));
  if (Number(balanceRow.balance) - coins < 0) {
    throw new AppError(409, 'COINS_ALREADY_SPENT', 'As moedas desta tarefa já foram gastas. Não dá para desmarcá-la.');
  }

  const [reopened] = await tx.update(tasks)
    .set({ status: 'pending', completedAt: null, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
    .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId), eq(tasks.status, 'completed'))).returning();
  if (!reopened) throw new AppError(409, 'TASK_NOT_COMPLETED', 'Esta tarefa não está concluída.');

  if (entries.length) {
    await tx.delete(rewardLedger)
      .where(and(eq(rewardLedger.userId, userId), eq(rewardLedger.sourceType, 'task_completion'), eq(rewardLedger.sourceId, task.id)));
  }

  const xpTotal = Math.max(0, pet.xpTotal - xp);
  const [updatedPet] = await tx.update(pets).set({ xpTotal, level: levelForXp(xpTotal), version: sql`${pets.version} + 1` })
    .where(eq(pets.id, pet.id)).returning();

  await recordSyncChange(tx, { userId, entityType: 'task', entityId: reopened.id, changeType: 'upsert', version: reopened.version, data: reopened });
  await recordSyncChange(tx, { userId, entityType: 'pet', entityId: updatedPet.id, changeType: 'upsert', version: updatedPet.version, data: updatedPet });

  return { task: reopened, refunded: { xp, coins }, pet: updatedPet };
}
