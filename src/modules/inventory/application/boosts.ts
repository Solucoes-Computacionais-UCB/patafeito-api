import { and, asc, eq, gt, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { activeBoosts } from '../../../db/schema/active-boosts.js';

export type Rewards = { xp: number; coins: number };

/**
 * Aplica os poderes ativos a uma recompensa. A janela dos poderes de tempo é conferida
 * no instante da conclusão, não do envio: uma tarefa feita offline vale o que valia na hora.
 * A ampulheta só vale para ciclos de foco e é gasta aqui.
 */
export async function boostedRewards(tx: Transaction, userId: string, at: Date, base: Rewards, source: 'task' | 'focus'): Promise<Rewards> {
  const timed = await tx.select({ effect: activeBoosts.effect }).from(activeBoosts).where(and(
    eq(activeBoosts.userId, userId),
    inArray(activeBoosts.effect, ['double_xp', 'double_coins']),
    lte(activeBoosts.startsAt, at),
    gt(activeBoosts.expiresAt, at),
  ));
  let { xp, coins } = base;
  if (timed.some((boost) => boost.effect === 'double_xp')) xp *= 2;
  if (timed.some((boost) => boost.effect === 'double_coins')) coins *= 2;

  if (source === 'focus') {
    const [hourglass] = await tx.select({ id: activeBoosts.id }).from(activeBoosts)
      .where(and(eq(activeBoosts.userId, userId), eq(activeBoosts.effect, 'focus_double'), isNotNull(activeBoosts.usesLeft), gt(activeBoosts.usesLeft, 0)))
      .orderBy(asc(activeBoosts.startsAt)).limit(1);
    if (hourglass) {
      await tx.update(activeBoosts).set({ usesLeft: sql`${activeBoosts.usesLeft} - 1` }).where(eq(activeBoosts.id, hourglass.id));
      xp *= 2;
      coins *= 2;
    }
  }
  return { xp, coins };
}
