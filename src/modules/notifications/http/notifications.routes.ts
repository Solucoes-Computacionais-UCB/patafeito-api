import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { notifications } from '../../../db/schema/notifications.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';

const updateInput = z.object({ read: z.boolean() });
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const items = await db.query.notifications.findMany({
    where: eq(notifications.userId, req.userId!),
    orderBy: [desc(notifications.createdAt)],
  });
  res.json({ data: items });
});

notificationsRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { read } = updateInput.parse(req.body);
  const [notification] = await db.update(notifications).set({ readAt: read ? new Date() : null })
    .where(and(eq(notifications.id, id), eq(notifications.userId, req.userId!))).returning();
  if (!notification) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notificação não encontrada.');
  res.json({ data: notification });
});
