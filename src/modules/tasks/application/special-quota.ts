import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { tasks } from '../../../db/schema/tasks.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { SPECIAL_WEEKLY_LIMIT, weekBounds } from '../domain/special.js';

/**
 * Garante a cota semanal de tarefas especiais (RN14) antes de criar mais uma.
 * Excluir uma especial não devolve a cota: a contagem inclui as removidas.
 */
export async function assertSpecialQuota(tx: Transaction, userId: string, now = new Date()) {
  // Serializa criações concorrentes do mesmo usuário para a contagem não estourar o limite.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
  const { start, end } = weekBounds(now);
  const [row] = await tx.select({ total: sql<string>`count(*)` }).from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.kind, 'special'), gte(tasks.createdAt, start), lt(tasks.createdAt, end)));
  if (Number(row.total) >= SPECIAL_WEEKLY_LIMIT) {
    throw new AppError(409, 'SPECIAL_LIMIT_REACHED', `Você já criou ${SPECIAL_WEEKLY_LIMIT} tarefas especiais nesta semana.`);
  }
}
