import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { friendships } from '../../../db/schema/friendships.js';
import { pets } from '../../../db/schema/pets.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { users } from '../../../db/schema/users.js';
import { monthStart, weekBounds } from '../../../shared/time/zoned.js';
import { streakFor } from '../../rewards/application/streak.js';
import { isOnline } from './presence.js';

export type Relation = 'self' | 'friend' | 'outgoing' | 'incoming' | 'none';

/** Dados públicos de uma pessoa para amigos: nunca inclui o e-mail. */
export type PublicProfile = {
  id: string;
  displayName: string;
  handle: string | null;
  pet: { speciesId: string; name: string; level: number } | null;
  online: boolean;
};

export type FriendSummary = PublicProfile & { streak: number; xpTotal: number; periodXp: number };

/** A amizade do par, em qualquer direção. */
export async function pairOf(tx: Transaction, a: string, b: string) {
  return tx.query.friendships.findFirst({
    where: or(and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)), and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a))),
  });
}

export function relationFor(viewerId: string, otherId: string, pair: typeof friendships.$inferSelect | undefined): Relation {
  if (viewerId === otherId) return 'self';
  if (!pair || pair.status === 'declined') return 'none';
  if (pair.status === 'accepted') return 'friend';
  return pair.requesterId === viewerId ? 'outgoing' : 'incoming';
}

/** Ids dos amigos aceitos. */
export async function friendIds(tx: Transaction, userId: string) {
  const rows = await tx.select({ requesterId: friendships.requesterId, addresseeId: friendships.addresseeId }).from(friendships)
    .where(and(eq(friendships.status, 'accepted'), or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))));
  return rows.map((row) => (row.requesterId === userId ? row.addresseeId : row.requesterId));
}

export async function publicProfiles(tx: Transaction, ids: string[]): Promise<PublicProfile[]> {
  if (!ids.length) return [];
  const rows = await tx.select({ id: users.id, displayName: users.displayName, handle: users.handle, lastSeenAt: users.lastSeenAt, speciesId: pets.speciesId, petName: pets.name, level: pets.level })
    .from(users).leftJoin(pets, eq(pets.userId, users.id)).where(inArray(users.id, ids));
  return rows.map((row) => ({
    id: row.id, displayName: row.displayName, handle: row.handle, online: isOnline(row.lastSeenAt),
    pet: row.speciesId && row.petName && row.level !== null ? { speciesId: row.speciesId, name: row.petName, level: row.level } : null,
  }));
}

/**
 * Resumo para lista de amigos, perfil e ranking: perfil público, sequência, XP total do pet e XP
 * ganho desde `since` (semana ou mês), somado do razão.
 */
export async function friendSummaries(tx: Transaction, ids: string[], since: Date): Promise<FriendSummary[]> {
  if (!ids.length) return [];
  const profiles = await publicProfiles(tx, ids);
  const xpRows = await tx.select({ userId: rewardLedger.userId, xp: sql<string>`coalesce(sum(${rewardLedger.xpDelta}), 0)` }).from(rewardLedger)
    .where(and(inArray(rewardLedger.userId, ids), gte(rewardLedger.occurredAt, since))).groupBy(rewardLedger.userId);
  const totals = await tx.select({ userId: pets.userId, xpTotal: pets.xpTotal }).from(pets).where(inArray(pets.userId, ids));
  const periodXp = new Map(xpRows.map((row) => [row.userId, Number(row.xp)]));
  const xpTotal = new Map(totals.map((row) => [row.userId, row.xpTotal]));
  const summaries: FriendSummary[] = [];
  for (const profile of profiles) {
    summaries.push({ ...profile, streak: await streakFor(tx, profile.id), xpTotal: xpTotal.get(profile.id) ?? 0, periodXp: periodXp.get(profile.id) ?? 0 });
  }
  return summaries;
}

export function periodStart(period: 'week' | 'month', now = new Date()) {
  return period === 'week' ? weekBounds(now).start : monthStart(now);
}
