import { and, desc, eq, gt, isNotNull, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db, type Transaction } from '../../../db/client.js';
import { activeBoosts } from '../../../db/schema/active-boosts.js';
import { idempotencyOperations } from '../../../db/schema/idempotency-operations.js';
import { inventory } from '../../../db/schema/inventory.js';
import { pets } from '../../../db/schema/pets.js';
import { shopItems } from '../../../db/schema/shop-items.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { nextStats } from '../../pets/domain/stats.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';

const equipInput = z.object({ itemId: z.string().uuid(), equipped: z.boolean().default(true) });
const useInput = z.object({ itemId: z.string().uuid(), localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const idempotencyKey = z.string().uuid();
const hourMs = 3_600_000;

type InventoryRow = typeof inventory.$inferSelect;
type UseResult = { inventoryItem: InventoryRow; pet: typeof pets.$inferSelect | null; boost: typeof activeBoosts.$inferSelect | null };

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const items = await db.select({ inventory, item: shopItems }).from(inventory)
    .innerJoin(shopItems, eq(inventory.itemId, shopItems.id)).where(eq(inventory.userId, req.userId!));
  res.json({ data: items });
});

/** Poderes em andamento e os dias já protegidos pelo escudo da sequência. */
inventoryRouter.get('/boosts', async (req: AuthenticatedRequest, res) => {
  const now = new Date();
  const rows = await db.select().from(activeBoosts).where(and(
    eq(activeBoosts.userId, req.userId!),
    or(gt(activeBoosts.expiresAt, now), gt(activeBoosts.usesLeft, 0), isNotNull(activeBoosts.protectedDate)),
  ));
  res.json({ data: {
    active: rows.filter((row) => !row.protectedDate).map(({ effect, expiresAt, usesLeft }) => ({ effect, expiresAt, usesLeft })),
    protectedDates: rows.flatMap((row) => (row.protectedDate ? [row.protectedDate] : [])).sort(),
  } });
});

/** Equipa ou tira um cosmético. Só um item equipado por categoria. */
inventoryRouter.patch('/', async (req: AuthenticatedRequest, res) => {
  const { itemId, equipped } = equipInput.parse(req.body);
  const userId = req.userId!;
  const item = await db.select({ inventory, shopItem: shopItems }).from(inventory)
    .innerJoin(shopItems, eq(inventory.itemId, shopItems.id))
    .where(and(eq(inventory.userId, userId), eq(inventory.itemId, itemId))).then((rows) => rows[0]);
  if (!item) throw new AppError(404, 'INVENTORY_ITEM_NOT_FOUND', 'O item não pertence ao inventário.');
  if (item.shopItem.consumable) throw new AppError(409, 'ITEM_NOT_EQUIPPABLE', 'Este item é usado, não equipado.');
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    if (equipped) {
      const ownedInSlot = await tx.select({ id: inventory.id }).from(inventory).innerJoin(shopItems, eq(inventory.itemId, shopItems.id))
        .where(and(eq(inventory.userId, userId), eq(shopItems.slot, item.shopItem.slot), eq(inventory.equipped, true)));
      for (const ownedItem of ownedInSlot) {
        const [unequipped] = await tx.update(inventory).set({ equipped: false }).where(eq(inventory.id, ownedItem.id)).returning();
        await recordSyncChange(tx, { userId, entityType: 'inventory', entityId: unequipped.id, changeType: 'upsert', version: unequipped.acquiredAt.toISOString(), data: unequipped });
      }
    }
    const [changed] = await tx.update(inventory).set({ equipped }).where(eq(inventory.id, item.inventory.id)).returning();
    await recordSyncChange(tx, { userId, entityType: 'inventory', entityId: changed.id, changeType: 'upsert', version: changed.acquiredAt.toISOString(), data: changed });
    return changed;
  });
  res.json({ data: updated });
});

/** Usa uma unidade de um consumível: comida e café mexem nos status; poderes ficam ativos. */
inventoryRouter.post('/use', async (req: AuthenticatedRequest, res) => {
  const key = idempotencyKey.parse(req.header('idempotency-key'));
  const input = useInput.parse(req.body);
  const userId = req.userId!;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    const previous = await tx.query.idempotencyOperations.findFirst({ where: and(eq(idempotencyOperations.userId, userId), eq(idempotencyOperations.key, key)) });
    if (previous) {
      if (previous.operation !== 'item_use' || previous.resourceId !== input.itemId) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'A chave de idempotência já foi usada para outra operação.');
      return previous.response as UseResult;
    }
    const response = await useItem(tx, userId, input);
    await tx.insert(idempotencyOperations).values({ userId, key, operation: 'item_use', resourceId: input.itemId, response });
    return response;
  });
  res.json({ data: result });
});

async function useItem(tx: Transaction, userId: string, input: z.infer<typeof useInput>): Promise<UseResult> {
  const owned = await tx.select({ inventory, item: shopItems }).from(inventory).innerJoin(shopItems, eq(inventory.itemId, shopItems.id))
    .where(and(eq(inventory.userId, userId), eq(inventory.itemId, input.itemId))).then((rows) => rows[0]);
  if (!owned || owned.inventory.quantity < 1) throw new AppError(404, 'INVENTORY_ITEM_NOT_FOUND', 'Você não tem este item.');
  if (!owned.item.consumable) throw new AppError(409, 'ITEM_NOT_USABLE', 'Este item é equipado, não usado.');

  const now = new Date();
  const effect = owned.item.effect;
  let pet: UseResult['pet'] = null;
  let boost: UseResult['boost'] = null;

  if (effect.type === 'stats') {
    const current = await tx.query.pets.findFirst({ where: eq(pets.userId, userId) });
    if (!current) throw new AppError(409, 'PET_REQUIRED', 'Crie um pet antes de usar este item.');
    [pet] = await tx.update(pets).set({ ...nextStats(current, now, effect), version: sql`${pets.version} + 1` }).where(eq(pets.id, current.id)).returning();
    await recordSyncChange(tx, { userId, entityType: 'pet', entityId: pet.id, changeType: 'upsert', version: pet.version, data: pet });
  } else if (effect.type === 'double_xp' || effect.type === 'double_coins') {
    // Usar de novo com o efeito ativo estende o tempo em vez de desperdiçar o item.
    const [running] = await tx.select({ expiresAt: activeBoosts.expiresAt }).from(activeBoosts)
      .where(and(eq(activeBoosts.userId, userId), eq(activeBoosts.effect, effect.type), gt(activeBoosts.expiresAt, now)))
      .orderBy(desc(activeBoosts.expiresAt)).limit(1);
    const startsAt = running?.expiresAt ?? now;
    [boost] = await tx.insert(activeBoosts).values({ userId, itemId: owned.item.id, effect: effect.type, startsAt, expiresAt: new Date(startsAt.getTime() + effect.hours * hourMs) }).returning();
  } else if (effect.type === 'focus_double') {
    [boost] = await tx.insert(activeBoosts).values({ userId, itemId: owned.item.id, effect: effect.type, usesLeft: 1 }).returning();
  } else if (effect.type === 'streak_shield') {
    if (!input.localDate) throw new AppError(422, 'LOCAL_DATE_REQUIRED', 'Informe o dia a proteger.');
    // O dia vem do fuso do aparelho; aceita um dia de folga em relação ao relógio do servidor.
    const offsetDays = Math.abs(new Date(`${input.localDate}T12:00:00Z`).getTime() - now.getTime()) / (24 * hourMs);
    if (!Number.isFinite(offsetDays) || offsetDays > 1.5) throw new AppError(422, 'INVALID_LOCAL_DATE', 'O escudo só protege o dia de hoje.');
    const already = await tx.query.activeBoosts.findFirst({ where: and(eq(activeBoosts.userId, userId), eq(activeBoosts.protectedDate, input.localDate)) });
    if (already) throw new AppError(409, 'DATE_ALREADY_PROTECTED', 'Hoje já está protegido.');
    [boost] = await tx.insert(activeBoosts).values({ userId, itemId: owned.item.id, effect: effect.type, protectedDate: input.localDate }).returning();
  } else {
    throw new AppError(409, 'ITEM_NOT_USABLE', 'Este item não pode ser usado.');
  }

  const [inventoryItem] = await tx.update(inventory).set({ quantity: sql`${inventory.quantity} - 1` }).where(eq(inventory.id, owned.inventory.id)).returning();
  await recordSyncChange(tx, { userId, entityType: 'inventory', entityId: inventoryItem.id, changeType: 'upsert', version: inventoryItem.acquiredAt.toISOString(), data: inventoryItem });
  return { inventoryItem, pet, boost };
}

