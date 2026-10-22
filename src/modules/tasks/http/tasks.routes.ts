import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { idempotencyOperations } from '../../../db/schema/idempotency-operations.js';
import { tasks } from '../../../db/schema/tasks.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';
import { completeTask, isOverdue, type TaskCompletionResult } from '../application/complete-task.js';
import { reopenTask } from '../application/reopen-task.js';

const difficulty = z.enum(['easy', 'medium', 'hard']);
const createTaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  difficulty,
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
});
const updateTaskInput = createTaskInput.partial().refine((input) => Object.keys(input).length > 0, 'Informe ao menos um campo para atualizar.');
const rescheduleInput = z.object({ dueAt: z.string().datetime({ offset: true }) });
const idempotencyKey = z.string().uuid();
const completeTaskInput = z.object({ completedAt: z.string().datetime({ offset: true }).optional() });

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

function taskIdParam(value: unknown) {
  return z.string().uuid().parse(value);
}

async function ownedTask(taskId: string, userId: string) {
  const task = await db.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)) });
  if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Tarefa não encontrada.');
  return task;
}

tasksRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const items = await db.query.tasks.findMany({
    where: and(eq(tasks.userId, req.userId!), isNull(tasks.deletedAt)),
    orderBy: [desc(tasks.createdAt)],
  });
  res.json({ data: items });
});

tasksRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const input = createTaskInput.parse(req.body);
  const dueAt = input.dueAt === undefined ? undefined : input.dueAt === null ? null : new Date(input.dueAt);
  const [task] = await db.insert(tasks).values({
    title: input.title,
    description: input.description,
    difficulty: input.difficulty,
    dueAt,
    userId: req.userId!,
  }).returning();
  await recordSyncChange(db, { userId: req.userId!, entityType: 'task', entityId: task.id, changeType: 'upsert', version: task.version, data: task });
  res.status(201).json({ data: task });
});

tasksRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  res.json({ data: await ownedTask(taskIdParam(req.params.id), req.userId!) });
});

tasksRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const input = updateTaskInput.parse(req.body);
  const task = await ownedTask(taskIdParam(req.params.id), req.userId!);
  if (task.status !== 'pending') throw new AppError(409, 'TASK_NOT_PENDING', 'Uma tarefa concluída não pode ser alterada.');
  if (isOverdue(task)) throw new AppError(409, 'TASK_OVERDUE', 'Uma tarefa vencida só pode ser excluída ou reagendada.');
  const [updated] = await db.update(tasks).set({
    ...input,
    dueAt: input.dueAt === undefined ? undefined : input.dueAt === null ? null : new Date(input.dueAt),
    version: sql`${tasks.version} + 1`,
    updatedAt: new Date(),
  }).where(and(eq(tasks.id, task.id), eq(tasks.userId, req.userId!))).returning();
  await recordSyncChange(db, { userId: req.userId!, entityType: 'task', entityId: updated.id, changeType: 'upsert', version: updated.version, data: updated });
  res.json({ data: updated });
});

tasksRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const task = await ownedTask(taskIdParam(req.params.id), req.userId!);
  const [deleted] = await db.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date(), version: sql`${tasks.version} + 1` }).where(and(eq(tasks.id, task.id), eq(tasks.userId, req.userId!))).returning();
  await recordSyncChange(db, { userId: req.userId!, entityType: 'task', entityId: deleted.id, changeType: 'delete', version: deleted.version, data: { id: deleted.id, deletedAt: deleted.deletedAt?.toISOString() } });
  res.status(204).send();
});

tasksRouter.post('/:id/reschedule', async (req: AuthenticatedRequest, res) => {
  const input = rescheduleInput.parse(req.body);
  const dueAt = new Date(input.dueAt);
  if (dueAt.getTime() <= Date.now()) throw new AppError(422, 'INVALID_DUE_DATE', 'A nova data deve estar no futuro.');
  const task = await ownedTask(taskIdParam(req.params.id), req.userId!);
  if (task.status !== 'pending') throw new AppError(409, 'TASK_NOT_PENDING', 'Uma tarefa concluída não pode ser reagendada.');
  const [updated] = await db.update(tasks).set({ dueAt, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
    .where(and(eq(tasks.id, task.id), eq(tasks.userId, req.userId!))).returning();
  await recordSyncChange(db, { userId: req.userId!, entityType: 'task', entityId: updated.id, changeType: 'upsert', version: updated.version, data: updated });
  res.json({ data: updated });
});

tasksRouter.post('/:id/reopen', async (req: AuthenticatedRequest, res) => {
  const taskId = taskIdParam(req.params.id);
  // Desfazer é idempotente por natureza: a segunda chamada encontra a tarefa pendente e recusa.
  const result = await db.transaction((tx) => reopenTask(tx, { userId: req.userId!, taskId }));
  res.json({ data: result });
});

tasksRouter.post('/:id/complete', async (req: AuthenticatedRequest, res) => {
  const key = idempotencyKey.parse(req.header('idempotency-key'));
  const input = completeTaskInput.parse(req.body);
  const completedAt = input.completedAt ? new Date(input.completedAt) : new Date();
  if (completedAt > new Date()) throw new AppError(422, 'INVALID_COMPLETION_DATE', 'A conclusão não pode estar no futuro.');
  const userId = req.userId!;
  const taskId = taskIdParam(req.params.id);
  const result = await db.transaction(async (tx) => {
    const previousOperation = await tx.query.idempotencyOperations.findFirst({
      where: and(eq(idempotencyOperations.userId, userId), eq(idempotencyOperations.key, key)),
    });
    if (previousOperation) {
      if (previousOperation.operation !== 'task_completion' || previousOperation.resourceId !== taskId) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'A chave de idempotência já foi usada para outra operação.');
      return previousOperation.response as TaskCompletionResult;
    }

    let response: TaskCompletionResult;
    try {
      response = await completeTask(tx, { userId, taskId, completedAt });
    } catch (error) {
      // Duas conclusões concorrentes com a mesma chave: a perdedora repete a resposta já gravada.
      if (error instanceof AppError && error.code === 'TASK_NOT_PENDING') {
        const concurrentOperation = await tx.query.idempotencyOperations.findFirst({
          where: and(eq(idempotencyOperations.userId, userId), eq(idempotencyOperations.key, key)),
        });
        if (concurrentOperation) return concurrentOperation.response as TaskCompletionResult;
      }
      throw error;
    }
    await tx.insert(idempotencyOperations).values({ userId, key, operation: 'task_completion', resourceId: taskId, response });
    return response;
  });
  res.json({ data: result });
});
