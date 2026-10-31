import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { activeBoosts } from '../../../db/schema/active-boosts.js';
import { pets } from '../../../db/schema/pets.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { tasks } from '../../../db/schema/tasks.js';
import { users } from '../../../db/schema/users.js';
import { deterministicUuid } from '../../../shared/ids/deterministic-uuid.js';
import { DEFAULT_TIMEZONE, localDateKey } from '../../../shared/time/zoned.js';
import { notify } from '../../notifications/application/notify.js';
import { levelForXp } from '../../pets/domain/progression.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';
import { currentStreak, streakBonus, streakEndingOn } from '../domain/streak.js';

/** Sequências mais longas que isto não mudam nenhum marco relevante; limita a consulta. */
const LOOKBACK_DAYS = 400;

export async function userTimezone(tx: Transaction, userId: string) {
  const [user] = await tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  return user?.timezone ?? DEFAULT_TIMEZONE;
}

/** Dias (`AAAA-MM-DD`, no fuso do usuário) com tarefa concluída ou salvos pelo escudo. */
export async function activityDays(tx: Transaction, userId: string, timeZone: string) {
  const completed = await tx.selectDistinct({ day: sql<string>`to_char(${tasks.completedAt} AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')` })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.status, 'completed'), isNotNull(tasks.completedAt), gt(tasks.completedAt, sql`now() - make_interval(days => ${LOOKBACK_DAYS})`)));
  const shielded = await tx.select({ day: activeBoosts.protectedDate }).from(activeBoosts)
    .where(and(eq(activeBoosts.userId, userId), isNotNull(activeBoosts.protectedDate)));
  return new Set([...completed.map((row) => row.day), ...shielded.flatMap((row) => (row.day ? [row.day] : []))]);
}

export async function streakFor(tx: Transaction, userId: string, now = new Date()) {
  const timeZone = await userTimezone(tx, userId);
  return currentStreak(await activityDays(tx, userId, timeZone), localDateKey(now, timeZone));
}

export type StreakBonus = { days: number; xp: number; coins: number };

/**
 * RN07: depois de uma conclusão, confere se o dia fechou um marco da sequência e paga o bônus.
 * O id do lançamento deriva de usuário + dia, então o bônus sai no máximo uma vez por dia,
 * mesmo com conclusões repetidas, desfeitas ou concorrentes.
 */
export async function awardStreakBonus(tx: Transaction, userId: string, completedAt: Date): Promise<{ bonus?: StreakBonus; pet?: typeof pets.$inferSelect }> {
  const timeZone = await userTimezone(tx, userId);
  const day = localDateKey(completedAt, timeZone);
  const days = await activityDays(tx, userId, timeZone);
  const streak = streakEndingOn(days, day);
  const reward = streakBonus(streak);
  if (!reward) return {};

  const [entry] = await tx.insert(rewardLedger)
    .values({ userId, sourceType: 'streak_bonus', sourceId: deterministicUuid(`streak_bonus:${userId}:${day}`), xpDelta: reward.xp, coinDelta: reward.coins })
    .onConflictDoNothing().returning();
  if (!entry) return {};

  const [pet] = await tx.update(pets)
    .set({ xpTotal: sql`${pets.xpTotal} + ${reward.xp}`, version: sql`${pets.version} + 1` })
    .where(eq(pets.userId, userId)).returning();
  let updated = pet;
  if (pet && pet.level !== levelForXp(pet.xpTotal)) {
    [updated] = await tx.update(pets).set({ level: levelForXp(pet.xpTotal) }).where(eq(pets.id, pet.id)).returning();
  }
  if (updated) await recordSyncChange(tx, { userId, entityType: 'pet', entityId: updated.id, changeType: 'upsert', version: updated.version, data: updated });
  await notify(tx, {
    userId, type: 'streak_bonus', title: `${streak} dias seguidos!`, body: `Bônus de sequência: +${reward.xp} XP e +${reward.coins} moedas.`,
    data: { streak }, dedupeKey: `streak_bonus:${day}`,
  });
  return { bonus: { days: streak, ...reward }, pet: updated };
}
