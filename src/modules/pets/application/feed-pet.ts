import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { pets } from '../../../db/schema/pets.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';
import { FEED_BOOST, FEED_COST_COINS, nextStats } from '../domain/stats.js';

export type FeedResult = { pet: typeof pets.$inferSelect; spent: { coins: number } };

/** Alimenta o pet gastando moedas. `feedId` vem do aparelho e torna o débito único no razão. */
export async function feedPet(tx: Transaction, input: { userId: string; feedId: string }): Promise<FeedResult> {
  const { userId, feedId } = input;
  // O saldo é lido e alterado aqui: serializa com compras e estornos do mesmo usuário.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
  const pet = await tx.query.pets.findFirst({ where: eq(pets.userId, userId) });
  if (!pet) throw new AppError(409, 'PET_REQUIRED', 'Crie um pet antes de alimentá-lo.');

  const [balanceRow] = await tx.select({ balance: sql<string>`coalesce(sum(${rewardLedger.coinDelta}), 0)` })
    .from(rewardLedger).where(eq(rewardLedger.userId, userId));
  if (Number(balanceRow.balance) < FEED_COST_COINS) throw new AppError(409, 'INSUFFICIENT_COINS', 'Moedas insuficientes para alimentar o pet.');

  await tx.insert(rewardLedger).values({ userId, sourceType: 'pet_feed', sourceId: feedId, xpDelta: 0, coinDelta: -FEED_COST_COINS });
  const [updatedPet] = await tx.update(pets).set({ ...nextStats(pet, new Date(), FEED_BOOST), version: sql`${pets.version} + 1` })
    .where(eq(pets.id, pet.id)).returning();
  await recordSyncChange(tx, { userId, entityType: 'pet', entityId: updatedPet.id, changeType: 'upsert', version: updatedPet.version, data: updatedPet });
  return { pet: updatedPet, spent: { coins: FEED_COST_COINS } };
}
