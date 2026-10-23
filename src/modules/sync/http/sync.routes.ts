import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { inventory } from '../../../db/schema/inventory.js';
import { notifications } from '../../../db/schema/notifications.js';
import { pets } from '../../../db/schema/pets.js';
import { syncChanges, syncOperations } from '../../../db/schema/sync.js';
import { tasks } from '../../../db/schema/tasks.js';
import { shopItems } from '../../../db/schema/shop-items.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { recordSyncChange } from '../infrastructure/change-log.js';
import { completeTask } from '../../tasks/application/complete-task.js';
import { reopenTask } from '../../tasks/application/reopen-task.js';
import { MAX_FOCUS_SECONDS, MIN_FOCUS_SECONDS, recordOfflineFocusSession } from '../../focus/application/complete-focus-session.js';
import { feedPet } from '../../pets/application/feed-pet.js';
import { checkRecurrence, recurrenceFields } from '../../tasks/domain/recurrence.js';

const difficulty = z.enum(['easy', 'medium', 'hard']);
const taskFields = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).nullable().optional(), difficulty, dueAt: z.string().datetime({ offset: true }).nullable().optional(), ...recurrenceFields });
const taskCreate = taskFields.superRefine(checkRecurrence);
const taskUpdate = taskFields.partial().refine((value) => Object.keys(value).length > 0, 'Informe campos para atualizar.').superRefine(checkRecurrence);
const taskComplete = z.object({ completedAt: z.string().datetime({ offset: true }).optional() });
const focusComplete = z.object({ startedAt: z.string().datetime({ offset: true }), finishedAt: z.string().datetime({ offset: true }), durationSeconds: z.number().int().min(MIN_FOCUS_SECONDS).max(MAX_FOCUS_SECONDS).optional() });
const operationInput = z.object({
  opId: z.string().uuid(),
  type: z.enum(['task.create', 'task.update', 'task.delete', 'task.complete', 'task.reopen', 'notification.read', 'inventory.equip', 'focus.complete', 'pet.feed']),
  resourceId: z.string().uuid().optional(),
  baseVersion: z.coerce.number().int().positive().optional(),
  payload: z.record(z.unknown()).default({}),
}).superRefine((value, context) => {
  if (value.type !== 'task.create' && !value.resourceId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['resourceId'], message: 'resourceId é obrigatório para esta operação.' });
  if (value.type === 'task.update' && !value.baseVersion) context.addIssue({ code: z.ZodIssueCode.custom, path: ['baseVersion'], message: 'baseVersion é obrigatória para editar uma tarefa.' });
});
const pushInput = z.object({ operations: z.array(operationInput).min(1).max(50) });
const pullQuery = z.object({ cursor: z.coerce.number().int().nonnegative().optional() });

type SyncResult = { opId: string; status: 'applied' | 'duplicate' | 'conflict' | 'rejected'; data?: unknown; reason?: string };

function taskData(task: typeof tasks.$inferSelect) {
  return { ...task, deletedAt: task.deletedAt?.toISOString() ?? null };
}

function isOverdue(task: { dueAt: Date | null }) {
  return task.dueAt !== null && task.dueAt.getTime() < Date.now();
}

async function applyOperation(userId: string, operation: z.infer<typeof operationInput>): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    const previous = await tx.query.syncOperations.findFirst({ where: and(eq(syncOperations.userId, userId), eq(syncOperations.opId, operation.opId)) });
    if (previous) return { ...(previous.result as Omit<SyncResult, 'status'>), opId: operation.opId, status: 'duplicate' };

    let result: SyncResult;
    try {
      if (operation.type === 'task.create') {
        const input = taskCreate.parse(operation.payload);
        // O app envia o id gerado no aparelho em `resourceId`, para que operações seguintes
        // do mesmo lote (concluir, editar) já referenciem a tarefa certa.
        const [created] = await tx.insert(tasks).values({ ...input, id: operation.resourceId, dueAt: input.dueAt ? new Date(input.dueAt) : null, userId })
          .onConflictDoNothing({ target: tasks.id }).returning();
        const task = created ?? await tx.query.tasks.findFirst({ where: and(eq(tasks.id, operation.resourceId!), eq(tasks.userId, userId)) });
        if (!task) throw new AppError(409, 'TASK_ID_IN_USE', 'Este identificador de tarefa já pertence a outra conta.');
        // Repetições têm id determinístico: outro aparelho pode recriar uma que já foi excluída.
        if (task.deletedAt) throw new AppError(409, 'TASK_DELETED', 'Esta tarefa já foi excluída.');
        if (created) await recordSyncChange(tx, { userId, entityType: 'task', entityId: task.id, changeType: 'upsert', version: task.version, data: taskData(task) });
        result = { opId: operation.opId, status: 'applied', data: taskData(task) };
      } else if (operation.type === 'task.update') {
        const input = taskUpdate.parse(operation.payload);
        const task = await tx.query.tasks.findFirst({ where: and(eq(tasks.id, operation.resourceId!), eq(tasks.userId, userId), isNull(tasks.deletedAt)) });
        if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Tarefa não encontrada.');
        if (task.status !== 'pending') throw new AppError(409, 'TASK_NOT_PENDING', 'Uma tarefa concluída não pode ser alterada.');
        if (isOverdue(task)) throw new AppError(409, 'TASK_OVERDUE', 'Uma tarefa vencida só pode ser excluída ou reagendada.');
        if (task.version !== operation.baseVersion) result = { opId: operation.opId, status: 'conflict', data: taskData(task), reason: 'A tarefa foi alterada em outro dispositivo.' };
        else {
          const [updated] = await tx.update(tasks).set({ ...input, dueAt: input.dueAt === undefined ? undefined : input.dueAt === null ? null : new Date(input.dueAt), version: sql`${tasks.version} + 1`, updatedAt: new Date() })
            .where(and(eq(tasks.id, task.id), eq(tasks.version, operation.baseVersion))).returning();
          if (!updated) throw new AppError(409, 'SYNC_CONFLICT', 'A tarefa foi alterada em outro dispositivo.');
          await recordSyncChange(tx, { userId, entityType: 'task', entityId: updated.id, changeType: 'upsert', version: updated.version, data: taskData(updated) });
          result = { opId: operation.opId, status: 'applied', data: taskData(updated) };
        }
      } else if (operation.type === 'task.delete') {
        const task = await tx.query.tasks.findFirst({ where: and(eq(tasks.id, operation.resourceId!), eq(tasks.userId, userId), isNull(tasks.deletedAt)) });
        if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Tarefa não encontrada.');
        const [deleted] = await tx.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date(), version: sql`${tasks.version} + 1` }).where(eq(tasks.id, task.id)).returning();
        await recordSyncChange(tx, { userId, entityType: 'task', entityId: deleted.id, changeType: 'delete', version: deleted.version, data: { id: deleted.id, deletedAt: deleted.deletedAt?.toISOString() } });
        result = { opId: operation.opId, status: 'applied', data: { id: deleted.id, version: deleted.version } };
      } else if (operation.type === 'task.complete') {
        const input = taskComplete.parse(operation.payload);
        const completedAt = input.completedAt ? new Date(input.completedAt) : new Date();
        if (completedAt.getTime() > Date.now() + 60_000) throw new AppError(409, 'INVALID_COMPLETION_DATE', 'A conclusão não pode estar no futuro.');
        const completion = await completeTask(tx, { userId, taskId: operation.resourceId!, completedAt });
        result = { opId: operation.opId, status: 'applied', data: { task: taskData(completion.task), rewards: completion.rewards, pet: completion.pet } };
      } else if (operation.type === 'task.reopen') {
        const reopened = await reopenTask(tx, { userId, taskId: operation.resourceId! });
        result = { opId: operation.opId, status: 'applied', data: { task: taskData(reopened.task), refunded: reopened.refunded, pet: reopened.pet } };
      } else if (operation.type === 'focus.complete') {
        const input = focusComplete.parse(operation.payload);
        const completion = await recordOfflineFocusSession(tx, { userId, sessionId: operation.resourceId!, startedAt: new Date(input.startedAt), finishedAt: new Date(input.finishedAt), durationSeconds: input.durationSeconds });
        result = { opId: operation.opId, status: 'applied', data: { session: completion.session, rewards: completion.rewards, pet: completion.pet } };
      } else if (operation.type === 'pet.feed') {
        const fed = await feedPet(tx, { userId, feedId: operation.resourceId! });
        result = { opId: operation.opId, status: 'applied', data: fed };
      } else if (operation.type === 'notification.read') {
        const read = z.object({ read: z.boolean() }).parse(operation.payload);
        const [notification] = await tx.update(notifications).set({ readAt: read.read ? new Date() : null }).where(and(eq(notifications.id, operation.resourceId!), eq(notifications.userId, userId))).returning();
        if (!notification) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notificação não encontrada.');
        await recordSyncChange(tx, { userId, entityType: 'notification', entityId: notification.id, changeType: 'upsert', version: notification.readAt?.toISOString() ?? notification.createdAt.toISOString(), data: notification });
        result = { opId: operation.opId, status: 'applied', data: notification };
      } else {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
        const selected = await tx.select({ inventory, shopItem: shopItems }).from(inventory)
          .innerJoin(shopItems, eq(inventory.itemId, shopItems.id))
          .where(and(eq(inventory.id, operation.resourceId!), eq(inventory.userId, userId))).then((rows) => rows[0]);
        if (!selected) throw new AppError(404, 'INVENTORY_ITEM_NOT_FOUND', 'O item não pertence ao inventário.');
        const inSlot = await tx.select({ id: inventory.id }).from(inventory).innerJoin(shopItems, eq(inventory.itemId, shopItems.id))
          .where(and(eq(inventory.userId, userId), eq(shopItems.slot, selected.shopItem.slot)));
        for (const item of inSlot) {
          const [unequipped] = await tx.update(inventory).set({ equipped: false }).where(eq(inventory.id, item.id)).returning();
          await recordSyncChange(tx, { userId, entityType: 'inventory', entityId: unequipped.id, changeType: 'upsert', version: unequipped.acquiredAt.toISOString(), data: unequipped });
        }
        const [equipped] = await tx.update(inventory).set({ equipped: true }).where(eq(inventory.id, selected.inventory.id)).returning();
        await recordSyncChange(tx, { userId, entityType: 'inventory', entityId: equipped.id, changeType: 'upsert', version: equipped.acquiredAt.toISOString(), data: equipped });
        result = { opId: operation.opId, status: 'applied', data: equipped };
      }
    } catch (error) {
      if (error instanceof AppError && error.status === 409) result = { opId: operation.opId, status: 'conflict', reason: error.message };
      else if (error instanceof AppError && error.status === 404) result = { opId: operation.opId, status: 'rejected', reason: error.message };
      else throw error;
    }
    await tx.insert(syncOperations).values({ userId, opId: operation.opId, operation: operation.type, resourceId: operation.resourceId, result });
    return result;
  });
}

export const syncRouter = Router();
syncRouter.use(requireAuth);

syncRouter.post('/push', async (req: AuthenticatedRequest, res) => {
  const { operations } = pushInput.parse(req.body);
  const results = [];
  for (const operation of operations) results.push(await applyOperation(req.userId!, operation));
  res.json({ data: { results } });
});

syncRouter.get('/pull', async (req: AuthenticatedRequest, res) => {
  const { cursor } = pullQuery.parse(req.query);
  const userId = req.userId!;
  if (cursor === undefined) {
    const [taskItems, petItems, inventoryItems, notificationItems] = await Promise.all([
      db.query.tasks.findMany({ where: and(eq(tasks.userId, userId), isNull(tasks.deletedAt)) }),
      db.query.pets.findMany({ where: eq(pets.userId, userId) }),
      db.query.inventory.findMany({ where: eq(inventory.userId, userId) }),
      db.query.notifications.findMany({ where: eq(notifications.userId, userId), orderBy: [desc(notifications.createdAt)] }),
    ]);
    const changes = [
      ...taskItems.map((item) => ({ entityType: 'task', entityId: item.id, changeType: 'upsert', version: String(item.version), data: taskData(item) })),
      ...petItems.map((item) => ({ entityType: 'pet', entityId: item.id, changeType: 'upsert', version: String(item.version), data: item })),
      ...inventoryItems.map((item) => ({ entityType: 'inventory', entityId: item.id, changeType: 'upsert', version: item.acquiredAt.toISOString(), data: item })),
      ...notificationItems.map((item) => ({ entityType: 'notification', entityId: item.id, changeType: 'upsert', version: item.readAt?.toISOString() ?? item.createdAt.toISOString(), data: item })),
    ];
    const [latest] = await db.select({ id: syncChanges.id }).from(syncChanges).where(eq(syncChanges.userId, userId)).orderBy(desc(syncChanges.id)).limit(1);
    return res.json({ data: { changes, nextCursor: latest ? String(latest.id) : '0', snapshot: true } });
  }
  const records = await db.query.syncChanges.findMany({ where: and(eq(syncChanges.userId, userId), gt(syncChanges.id, cursor)), orderBy: [syncChanges.id], limit: 101 });
  const hasMore = records.length > 100;
  const changes = records.slice(0, 100);
  const nextCursor = changes.length ? String(changes[changes.length - 1].id) : String(cursor);
  return res.json({ data: { changes, nextCursor, hasMore, snapshot: false } });
});
