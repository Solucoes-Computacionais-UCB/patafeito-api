import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { focusSessions } from '../../../db/schema/focus-sessions.js';
import { idempotencyOperations } from '../../../db/schema/idempotency-operations.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { finishFocusSession, MAX_FOCUS_SECONDS, MIN_FOCUS_SECONDS, POMODORO_DURATION_SECONDS, type FocusCompletionResult } from '../application/complete-focus-session.js';

const idempotencyKey = z.string().uuid();
const startInput = z.object({ durationSeconds: z.number().int().min(MIN_FOCUS_SECONDS).max(MAX_FOCUS_SECONDS).default(POMODORO_DURATION_SECONDS) });

function sessionIdParam(value: unknown) {
  return z.string().uuid().parse(value);
}

export const focusRouter = Router();
focusRouter.use(requireAuth);

focusRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { durationSeconds } = startInput.parse(req.body ?? {});
  const [session] = await db.insert(focusSessions).values({
    userId: req.userId!,
    durationSeconds,
  }).returning();
  res.status(201).json({ data: session });
});

focusRouter.post('/:id/finish', async (req: AuthenticatedRequest, res) => {
  const key = idempotencyKey.parse(req.header('idempotency-key'));
  const userId = req.userId!;
  const sessionId = sessionIdParam(req.params.id);
  const result = await db.transaction(async (tx) => {
    const previousOperation = await tx.query.idempotencyOperations.findFirst({
      where: and(eq(idempotencyOperations.userId, userId), eq(idempotencyOperations.key, key)),
    });
    if (previousOperation) {
      if (previousOperation.operation !== 'focus_session_completion' || previousOperation.resourceId !== sessionId) {
        throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'A chave de idempotência já foi usada para outra operação.');
      }
      return previousOperation.response as FocusCompletionResult;
    }

    let response: FocusCompletionResult;
    try {
      response = await finishFocusSession(tx, { userId, sessionId, finishedAt: new Date() });
    } catch (error) {
      // Duas finalizações concorrentes com a mesma chave: a perdedora repete a resposta já gravada.
      if (error instanceof AppError && error.code === 'FOCUS_SESSION_NOT_ACTIVE') {
        const concurrentOperation = await tx.query.idempotencyOperations.findFirst({
          where: and(eq(idempotencyOperations.userId, userId), eq(idempotencyOperations.key, key)),
        });
        if (concurrentOperation) return concurrentOperation.response as FocusCompletionResult;
      }
      throw error;
    }
    await tx.insert(idempotencyOperations).values({ userId, key, operation: 'focus_session_completion', resourceId: sessionId, response });
    return response;
  });
  res.json({ data: result });
});
