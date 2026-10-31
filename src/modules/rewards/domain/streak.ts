import { addDays } from '../../../shared/time/zoned.js';

/**
 * Sequência de dias produtivos (RN07). Um dia conta quando tem tarefa concluída ou foi salvo pelo
 * Escudo da sequência. Mesma regra de `currentStreak` no app.
 */

/** Dias seguidos que terminam em `day` (inclusive). */
export function streakEndingOn(days: ReadonlySet<string>, day: string) {
  let streak = 0;
  for (let cursor = day; days.has(cursor); cursor = addDays(cursor, -1)) streak += 1;
  return streak;
}

/** Sequência atual: conta a partir de hoje ou, se hoje ainda não teve atividade, a partir de ontem. */
export function currentStreak(days: ReadonlySet<string>, today: string) {
  return days.has(today) ? streakEndingOn(days, today) : streakEndingOn(days, addDays(today, -1));
}

/** Bônus do marco atingido: 3º dia, e o 7º e cada múltiplo de 7. Fora dos marcos, nada. */
export function streakBonus(streak: number): { xp: number; coins: number } | null {
  if (streak > 0 && streak % 7 === 0) return { xp: 30, coins: 15 };
  if (streak === 3) return { xp: 10, coins: 5 };
  return null;
}
