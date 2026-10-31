import { and, eq, isNull } from 'drizzle-orm';
import type { Transaction } from '../../../db/client.js';
import { notifications } from '../../../db/schema/notifications.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';

/** "Marcar todas": lê todas as não lidas de uma vez e avisa os outros aparelhos pelo sync. */
export async function markAllNotificationsRead(tx: Transaction, userId: string, now = new Date()) {
  const updated = await tx.update(notifications).set({ readAt: now })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).returning();
  for (const notification of updated) {
    await recordSyncChange(tx, { userId, entityType: 'notification', entityId: notification.id, changeType: 'upsert', version: now.toISOString(), data: notification });
  }
  return { updated: updated.length };
}
