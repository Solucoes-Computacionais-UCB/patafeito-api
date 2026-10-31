import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { focusSessions } from '../../../db/schema/focus-sessions.js';
import { pets } from '../../../db/schema/pets.js';
import { rewardLedger } from '../../../db/schema/reward-ledger.js';
import { tasks } from '../../../db/schema/tasks.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { addDays, localDateKey, startOfLocalDate } from '../../../shared/time/zoned.js';
import { levelForXp } from '../../pets/domain/progression.js';
import { streakFor, userTimezone } from '../../rewards/application/streak.js';

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.');
const overviewQuery = z.object({ from: dateKey.optional(), to: dateKey.optional() });
/** Período máximo de uma consulta, para a agregação continuar barata. */
const MAX_RANGE_DAYS = 366;

type DailyRow = { date: string; tasks: number; xp: number; focusMinutes: number };

export const statsRouter = Router();
statsRouter.use(requireAuth);

/**
 * Registro de produtividade (REGISTRO_PRODUTIVIDADE do roteiro), derivado do razão, das tarefas
 * e das sessões de foco, por dia local do usuário. Padrão: últimos 30 dias.
 */
statsRouter.get('/overview', async (req: AuthenticatedRequest, res) => {
  const query = overviewQuery.parse(req.query);
  const userId = req.userId!;
  const data = await db.transaction(async (tx) => {
    const timeZone = await userTimezone(tx, userId);
    const to = query.to ?? localDateKey(new Date(), timeZone);
    const from = query.from ?? addDays(to, -29);
    if (from > to) throw new AppError(422, 'INVALID_RANGE', 'A data inicial deve ser anterior à final.');
    if (from < addDays(to, -(MAX_RANGE_DAYS - 1))) throw new AppError(422, 'RANGE_TOO_LONG', `Consulte no máximo ${MAX_RANGE_DAYS} dias por vez.`);
    const start = startOfLocalDate(from, timeZone);
    const end = startOfLocalDate(addDays(to, 1), timeZone);
    // Agrupa pela 1ª coluna (`GROUP BY 1`): o fuso vai como parâmetro e o Postgres não reconheceria a mesma expressão repetida.
    const localDay = (column: typeof tasks.completedAt | typeof rewardLedger.occurredAt | typeof focusSessions.finishedAt) =>
      sql<string>`to_char(${column} AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`;

    const taskDays = await tx.select({ date: localDay(tasks.completedAt), total: sql<string>`count(*)` }).from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, 'completed'), isNull(tasks.deletedAt), gte(tasks.completedAt, start), lt(tasks.completedAt, end)))
      .groupBy(sql`1`);
    const xpDays = await tx.select({ date: localDay(rewardLedger.occurredAt), total: sql<string>`coalesce(sum(${rewardLedger.xpDelta}), 0)` }).from(rewardLedger)
      .where(and(eq(rewardLedger.userId, userId), gte(rewardLedger.occurredAt, start), lt(rewardLedger.occurredAt, end)))
      .groupBy(sql`1`);
    const focusDays = await tx.select({ date: localDay(focusSessions.finishedAt), total: sql<string>`coalesce(sum(${focusSessions.durationSeconds}), 0)` }).from(focusSessions)
      .where(and(eq(focusSessions.userId, userId), eq(focusSessions.status, 'completed'), gte(focusSessions.finishedAt, start), lt(focusSessions.finishedAt, end)))
      .groupBy(sql`1`);
    const categories = await tx.select({ category: tasks.category, total: sql<string>`count(*)` }).from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, 'completed'), isNull(tasks.deletedAt), gte(tasks.completedAt, start), lt(tasks.completedAt, end)))
      .groupBy(tasks.category);
    const pet = await tx.query.pets.findFirst({ columns: { xpTotal: true }, where: eq(pets.userId, userId) });

    const byDate = new Map<string, DailyRow>();
    const row = (date: string) => byDate.get(date) ?? byDate.set(date, { date, tasks: 0, xp: 0, focusMinutes: 0 }).get(date)!;
    for (const day of taskDays) row(day.date).tasks = Number(day.total);
    for (const day of xpDays) row(day.date).xp = Number(day.total);
    for (const day of focusDays) row(day.date).focusMinutes = Math.round(Number(day.total) / 60);
    const daily: DailyRow[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) daily.push(byDate.get(date) ?? { date, tasks: 0, xp: 0, focusMinutes: 0 });

    const xpTotal = pet?.xpTotal ?? 0;
    return {
      from, to, timeZone,
      totals: {
        tasksCompleted: daily.reduce((sum, day) => sum + day.tasks, 0),
        focusMinutes: daily.reduce((sum, day) => sum + day.focusMinutes, 0),
        xp: daily.reduce((sum, day) => sum + day.xp, 0),
        activeDays: daily.filter((day) => day.tasks > 0 || day.focusMinutes > 0).length,
        streak: await streakFor(tx, userId),
        xpTotal,
        level: levelForXp(xpTotal),
      },
      daily,
      byCategory: Object.fromEntries(categories.map((item) => [item.category, Number(item.total)])),
    };
  });
  res.json({ data });
});
