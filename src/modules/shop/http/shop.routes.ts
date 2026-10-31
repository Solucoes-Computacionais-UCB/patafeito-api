import { and, asc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { inventory } from '../../../db/schema/inventory.js';
import { pets } from '../../../db/schema/pets.js';
import { idempotencyOperations } from '../../../db/schema/idempotency-operations.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { shopItems } from '../../../db/schema/shop-items.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';

const purchaseInput = z.object({ itemId: z.string().uuid() });
const idempotencyKey = z.string().uuid();
type PurchaseResult = { item: typeof shopItems.$inferSelect; inventoryItem: typeof inventory.$inferSelect; balanceCoins: number };

export const shopRouter = Router();
shopRouter.use(requireAuth);

shopRouter.get('/items', async (_req, res) => {
  const items = await db.query.shopItems.findMany({ where: eq(shopItems.active, true), orderBy: [asc(shopItems.sortOrder), asc(shopItems.priceCoins)] });
  res.json({ data: items });
});

shopRouter.post('/purchases', async (req: AuthenticatedRequest, res) => {
  const key = idempotencyKey.parse(req.header('idempotency-key'));
  const { itemId } = purchaseInput.parse(req.body);
  const userId = req.userId!;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    const previousOperation = await tx.query.idempotencyOperations.findFirst({ where: and(eq(idempotencyOperations.userId, userId), eq(idempotencyOperations.key, key)) });
    if (previousOperation) {
      if (previousOperation.operation !== 'shop_purchase' || previousOperation.resourceId !== itemId) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'A chave de idempotência já foi usada para outra operação.');
      return previousOperation.response as PurchaseResult;
    }
    const item = await tx.query.shopItems.findFirst({ where: and(eq(shopItems.id, itemId), eq(shopItems.active, true)) });
    if (!item) throw new AppError(404, 'SHOP_ITEM_NOT_FOUND', 'Item da loja não encontrado.');
    // RN12: itens com nível mínimo ficam bloqueados até o pet chegar lá.
    const pet = await tx.query.pets.findFirst({ columns: { level: true }, where: eq(pets.userId, userId) });
    if ((pet?.level ?? 1) < item.minLevel) throw new AppError(409, 'ITEM_LOCKED', `Este item desbloqueia no nível ${item.minLevel}.`);
    const owned = await tx.query.inventory.findFirst({ where: and(eq(inventory.userId, userId), eq(inventory.itemId, itemId)) });
    if (owned && !item.consumable) throw new AppError(409, 'ITEM_ALREADY_OWNED', 'Este item já pertence ao inventário.');
    const [balanceRow] = await tx.select({ balance: sql<string>`coalesce(sum(${rewardLedger.coinDelta}), 0)` }).from(rewardLedger).where(eq(rewardLedger.userId, userId));
    const balanceCoins = Number(balanceRow.balance);
    if (balanceCoins < item.priceCoins) throw new AppError(409, 'INSUFFICIENT_COINS', 'Moedas insuficientes para comprar este item.');
    // Consumíveis acumulam: comprar de novo soma uma unidade à mesma linha do inventário.
    const [inventoryItem] = owned
      ? await tx.update(inventory).set({ quantity: sql`${inventory.quantity} + 1` }).where(eq(inventory.id, owned.id)).returning()
      : await tx.insert(inventory).values({ userId, itemId }).returning();
    await recordSyncChange(tx, { userId, entityType: 'inventory', entityId: inventoryItem.id, changeType: 'upsert', version: inventoryItem.acquiredAt.toISOString(), data: inventoryItem });
    // A chave de idempotência identifica cada compra: o mesmo consumível pode ser comprado várias vezes.
    await tx.insert(rewardLedger).values({ userId, sourceType: 'shop_purchase', sourceId: key, xpDelta: 0, coinDelta: -item.priceCoins });
    const response: PurchaseResult = { item, inventoryItem, balanceCoins: balanceCoins - item.priceCoins };
    await tx.insert(idempotencyOperations).values({ userId, key, operation: 'shop_purchase', resourceId: item.id, response });
    return response;
  });
  res.status(201).json({ data: result });
});
