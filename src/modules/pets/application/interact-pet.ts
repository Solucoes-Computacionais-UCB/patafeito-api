import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { pets } from '../../../db/schema/pets.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';
import { canPamper, nextPamperAt, nextStats, PAMPER_BOOST } from '../domain/stats.js';

export type PamperResult = {
  pet: typeof pets.$inferSelect;
  /** `false` quando o carinho veio antes de 1 h do anterior: o pato reage, mas a felicidade não muda. */
  counted: boolean;
  nextAt: Date;
};

/**
 * Mimar (Tela 6): tocar no pato. Grátis, +5 de felicidade, conta no máximo uma vez por hora.
 * Toques repetidos (ou reenviados pelo sync) dentro da hora não são erro: só não contam.
 */
export async function pamperPet(tx: Transaction, input: { userId: string; now?: Date }): Promise<PamperResult> {
  const now = input.now ?? new Date();
  const [pet] = await tx.select().from(pets).where(eq(pets.userId, input.userId)).for('update');
  if (!pet) throw new AppError(409, 'PET_REQUIRED', 'Crie um pet antes de cuidar dele.');
  if (!canPamper(pet.lastPamperedAt, now)) return { pet, counted: false, nextAt: nextPamperAt(pet.lastPamperedAt!) };

  const [updated] = await tx.update(pets)
    .set({ ...nextStats(pet, now, PAMPER_BOOST), lastPamperedAt: now, version: sql`${pets.version} + 1` })
    .where(eq(pets.id, pet.id)).returning();
  await recordSyncChange(tx, { userId: input.userId, entityType: 'pet', entityId: updated.id, changeType: 'upsert', version: updated.version, data: updated });
  return { pet: updated, counted: true, nextAt: nextPamperAt(now) };
}
