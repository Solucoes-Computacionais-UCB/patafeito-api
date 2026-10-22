import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../../db/client.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';

export const rewardsRouter = Router();
rewardsRouter.use(requireAuth);

rewardsRouter.get('/balance', async (req: AuthenticatedRequest, res) => {
  const [totals] = await db.select({
    coins: sql<string>`coalesce(sum(${rewardLedger.coinDelta}), 0)`,
    xpTotal: sql<string>`coalesce(sum(${rewardLedger.xpDelta}), 0)`,
  }).from(rewardLedger).where(eq(rewardLedger.userId, req.userId!));
  res.json({ data: { coins: Number(totals.coins), xpTotal: Number(totals.xpTotal) } });
});
