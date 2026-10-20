import { and, asc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { inventory } from '../../../db/schema/inventory.js';
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
  const items = await db.query.shopItems.findMany({ where: eq(shopItems.active, true), orderBy: [asc(shopItems.priceCoins)] });
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
    const owned = await tx.query.inventory.findFirst({ where: and(eq(inventory.userId, userId), eq(inventory.itemId, itemId)) });
    if (owned) throw new AppError(409, 'ITEM_ALREADY_OWNED', 'Este item já pertence ao inventário.');
    const [balanceRow] = await tx.select({ balance: sql<string>`coalesce(sum(${rewardLedger.coinDelta}), 0)` }).from(rewardLedger).where(eq(rewardLedger.userId, userId));
    const balanceCoins = Number(balanceRow.balance);
    if (balanceCoins < item.priceCoins) throw new AppError(409, 'INSUFFICIENT_COINS', 'Moedas insuficientes para comprar este item.');
    const [inventoryItem] = await tx.insert(inventory).values({ userId, itemId }).returning();
    await recordSyncChange(tx, { userId, entityType: 'inventory', entityId: inventoryItem.id, changeType: 'upsert', version: inventoryItem.acquiredAt.toISOString(), data: inventoryItem });
    await tx.insert(rewardLedger).values({ userId, sourceType: 'shop_purchase', sourceId: item.id, xpDelta: 0, coinDelta: -item.priceCoins });
    const response: PurchaseResult = { item, inventoryItem, balanceCoins: balanceCoins - item.priceCoins };
    await tx.insert(idempotencyOperations).values({ userId, key, operation: 'shop_purchase', resourceId: item.id, response });
    return response;
  });
  res.status(201).json({ data: result });
});
