import { and, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { inventory } from '../../../db/schema/inventory.js';
import { shopItems } from '../../../db/schema/shop-items.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';

const equipInput = z.object({ itemId: z.string().uuid() });
export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const items = await db.select({ inventory, item: shopItems }).from(inventory)
    .innerJoin(shopItems, eq(inventory.itemId, shopItems.id)).where(eq(inventory.userId, req.userId!));
  res.json({ data: items });
});

inventoryRouter.patch('/', async (req: AuthenticatedRequest, res) => {
  const { itemId } = equipInput.parse(req.body);
  const userId = req.userId!;
  const item = await db.select({ inventory, shopItem: shopItems }).from(inventory)
    .innerJoin(shopItems, eq(inventory.itemId, shopItems.id))
    .where(and(eq(inventory.userId, userId), eq(inventory.itemId, itemId))).then((rows) => rows[0]);
  if (!item) throw new AppError(404, 'INVENTORY_ITEM_NOT_FOUND', 'O item não pertence ao inventário.');
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    const ownedInSlot = await tx.select({ id: inventory.id }).from(inventory).innerJoin(shopItems, eq(inventory.itemId, shopItems.id))
      .where(and(eq(inventory.userId, userId), eq(shopItems.slot, item.shopItem.slot)));
    for (const ownedItem of ownedInSlot) {
      await tx.update(inventory).set({ equipped: false }).where(eq(inventory.id, ownedItem.id));
    }
    await tx.update(inventory).set({ equipped: true }).where(eq(inventory.id, item.inventory.id));
  });
  res.json({ data: { ...item.inventory, equipped: true } });
});
