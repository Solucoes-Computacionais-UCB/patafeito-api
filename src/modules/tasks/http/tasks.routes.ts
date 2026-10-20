import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { pets } from '../../../db/schema/pets.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { idempotencyOperations } from '../../../db/schema/idempotency-operations.js';
import { notifications } from '../../../db/schema/notifications.js';
import { tasks } from '../../../db/schema/tasks.js';
import { taskXp, type Difficulty } from '../../rewards/domain/rewards.js';
import { levelForXp } from '../../pets/domain/progression.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { recordSyncChange } from '../../sync/infrastructure/change-log.js';

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
type CompletionResult = { task: typeof tasks.$inferSelect; rewards: { xp: number; coins: number }; pet: typeof pets.$inferSelect };

const taskCoins: Record<Difficulty, number> = { easy: 2, medium: 4, hard: 8 };

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

function isOverdue(task: { dueAt: Date | null }) {
  return task.dueAt !== null && task.dueAt.getTime() < Date.now();
}

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
      return previousOperation.response as CompletionResult;
    }

    const task = await tx.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)) });
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Tarefa não encontrada.');
    const pet = await tx.query.pets.findFirst({ where: eq(pets.userId, userId) });
    if (!pet) throw new AppError(409, 'PET_REQUIRED', 'Crie um pet antes de concluir tarefas.');
    if (task.status !== 'pending') throw new AppError(409, 'TASK_NOT_PENDING', 'Esta tarefa já foi concluída.');
    if (isOverdue(task)) throw new AppError(409, 'TASK_OVERDUE', 'Uma tarefa vencida não pode ser concluída.');

    const [completedTask] = await tx.update(tasks).set({ status: 'completed', completedAt, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
      .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId), eq(tasks.status, 'pending'))).returning();
    if (!completedTask) {
      const concurrentOperation = await tx.query.idempotencyOperations.findFirst({
        where: and(eq(idempotencyOperations.userId, userId), eq(idempotencyOperations.key, key)),
      });
      if (concurrentOperation) return concurrentOperation.response as CompletionResult;
      throw new AppError(409, 'TASK_NOT_PENDING', 'Esta tarefa já foi concluída.');
    }

    const xp = taskXp(task.difficulty as Difficulty);
    const coins = taskCoins[task.difficulty as Difficulty];
    await tx.insert(rewardLedger).values({ userId, sourceType: 'task_completion', sourceId: task.id, xpDelta: xp, coinDelta: coins });
    const xpTotal = pet.xpTotal + xp;
    const [updatedPet] = await tx.update(pets).set({ xpTotal, level: levelForXp(xpTotal), version: sql`${pets.version} + 1` })
      .where(eq(pets.id, pet.id)).returning();
    const response: CompletionResult = { task: completedTask, rewards: { xp, coins }, pet: updatedPet };
    await tx.insert(idempotencyOperations).values({ userId, key, operation: 'task_completion', resourceId: taskId, response });
    await recordSyncChange(tx, { userId, entityType: 'task', entityId: completedTask.id, changeType: 'upsert', version: completedTask.version, data: completedTask });
    await recordSyncChange(tx, { userId, entityType: 'pet', entityId: updatedPet.id, changeType: 'upsert', version: updatedPet.version, data: updatedPet });
    const [notification] = await tx.insert(notifications).values({ userId, type: 'task_completed', title: 'Tarefa concluída!', body: `Você ganhou ${xp} XP e ${coins} moedas.`, data: { taskId: task.id } }).returning();
    await recordSyncChange(tx, { userId, entityType: 'notification', entityId: notification.id, changeType: 'upsert', version: notification.createdAt.toISOString(), data: notification });
    return response;
  });
  res.json({ data: result });
});
