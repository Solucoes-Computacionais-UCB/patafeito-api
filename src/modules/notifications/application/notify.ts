import type { Transaction } from '../../../db/client.js';
import { notifications } from '../../../db/schema/notifications.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';

export type NewNotification = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Mesma chave para o mesmo usuário = a notificação não se repete (as rotinas rodam a cada minuto). */
  dedupeKey?: string;
};

/** Cria a notificação e a envia ao app pelo sync. Com `dedupeKey` repetida, não faz nada. */
export async function notify(tx: Transaction, input: NewNotification) {
  const [created] = await tx.insert(notifications)
    .values({ userId: input.userId, type: input.type, title: input.title, body: input.body, data: input.data ?? {}, dedupeKey: input.dedupeKey })
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
    .returning();
  if (created) {
    await recordSyncChange(tx, { userId: input.userId, entityType: 'notification', entityId: created.id, changeType: 'upsert', version: created.createdAt.toISOString(), data: created });
  }
  return created;
}
