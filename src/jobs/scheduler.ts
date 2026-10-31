import { and, between, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { pets } from '../db/schema/pets.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import { notify } from '../modules/notifications/application/notify.js';
import { refreshPetState } from '../modules/pets/application/pet-state.js';
import { decayStats, LOW_STAT_THRESHOLD } from '../modules/pets/domain/stats.js';
import { INACTIVITY_HOURS } from '../modules/pets/domain/mood.js';
import { activityDays } from '../modules/rewards/application/streak.js';
import { currentStreak } from '../modules/rewards/domain/streak.js';
import { addDays, localDateKey, localHour } from '../shared/time/zoned.js';

/** Chave do advisory lock: com várias instâncias da API, só uma roda as rotinas por vez. */
const JOBS_LOCK_KEY = 72_310_001;
export const JOBS_INTERVAL_MS = 60_000;
/** Lembrete de prazo: tarefas que vencem dentro desta janela. */
const DUE_SOON_MS = 60 * 60_000;
/** Alertas de fome/cansaço no máximo uma vez a cada 6h. */
const PET_ALERT_BUCKET_MS = 6 * 3_600_000;
/** A partir desta hora local avisamos que a sequência está em risco. */
const STREAK_RISK_HOUR = 20;

/** RN02 e RN11 para quem não abre o app: a mesma função que roda na leitura do pet. */
async function applyPetPenalties(now: Date) {
  const overdueOwners = await db.selectDistinct({ userId: tasks.userId }).from(tasks).where(and(
    eq(tasks.status, 'pending'), isNull(tasks.deletedAt), isNull(tasks.overdueProcessedAt), lt(tasks.dueAt, now),
  ));
  const inactiveSince = new Date(now.getTime() - INACTIVITY_HOURS * 3_600_000);
  const lonelyOwners = await db.select({ userId: pets.userId }).from(pets).where(
    lt(sql`coalesce(${pets.lastActivityAt}, ${pets.createdAt})`, inactiveSince),
  );
  const userIds = new Set([...overdueOwners, ...lonelyOwners].map((row) => row.userId));
  for (const userId of userIds) await db.transaction((tx) => refreshPetState(tx, userId, now));
  return userIds.size;
}

/** HU19: tarefas que vencem na próxima hora. A chave inclui o prazo: reagendar gera novo lembrete. */
async function remindDueSoon(now: Date) {
  const soon = await db.select({ id: tasks.id, userId: tasks.userId, title: tasks.title, dueAt: tasks.dueAt }).from(tasks).where(and(
    eq(tasks.status, 'pending'), isNull(tasks.deletedAt), between(tasks.dueAt, now, new Date(now.getTime() + DUE_SOON_MS)),
  ));
  for (const task of soon) {
    await db.transaction((tx) => notify(tx, {
      userId: task.userId, type: 'task_due_soon', title: 'Prazo chegando', body: `“${task.title}” vence em menos de 1 hora.`,
      data: { taskId: task.id }, dedupeKey: `task_due_soon:${task.id}:${task.dueAt!.toISOString()}`,
    }));
  }
  return soon.length;
}

/** HU20: saciedade ou energia baixas, projetadas até agora. */
async function petNeeds(now: Date) {
  const bucket = Math.floor(now.getTime() / PET_ALERT_BUCKET_MS);
  const rows = await db.select().from(pets).where(or(lt(pets.hunger, 100), lt(pets.energy, 100)));
  let sent = 0;
  for (const pet of rows) {
    const stats = decayStats(pet, now);
    const alerts = [
      stats.hunger < LOW_STAT_THRESHOLD ? { type: 'pet_hungry', title: `${pet.name} está com fome`, body: 'Alimente o pato na tela de cuidados ou com uma comida da mochila.' } : null,
      stats.energy < LOW_STAT_THRESHOLD ? { type: 'pet_tired', title: `${pet.name} está cansado`, body: 'Um ciclo de foco ou um cuidado de "Curar" recarrega a energia.' } : null,
    ].filter((alert) => alert !== null);
    for (const alert of alerts) {
      const created = await db.transaction((tx) => notify(tx, { userId: pet.userId, ...alert, dedupeKey: `${alert.type}:${bucket}` }));
      if (created) sent += 1;
    }
  }
  return sent;
}

/** Às 20h locais, quem tem sequência de 2+ dias e nada concluído hoje recebe o aviso. */
async function streakAtRisk(now: Date) {
  const rows = await db.select({ userId: users.id, timezone: users.timezone }).from(users).innerJoin(pets, eq(pets.userId, users.id));
  let sent = 0;
  for (const user of rows) {
    if (localHour(now, user.timezone) < STREAK_RISK_HOUR) continue;
    const today = localDateKey(now, user.timezone);
    const created = await db.transaction(async (tx) => {
      const days = await activityDays(tx, user.userId, user.timezone);
      if (days.has(today)) return undefined;
      const streak = currentStreak(days, today);
      if (streak < 2) return undefined;
      return notify(tx, {
        userId: user.userId, type: 'streak_risk', title: 'Sequência em risco', body: `Você está há ${streak} dias seguidos. Conclua uma tarefa até meia-noite para não perder.`,
        data: { streak, until: addDays(today, 1) }, dedupeKey: `streak_risk:${today}`,
      });
    });
    if (created) sent += 1;
  }
  return sent;
}

/**
 * Uma rodada de todas as rotinas. Cada uma é idempotente (dedupe e marcações), então rodar duas
 * vezes no mesmo minuto não duplica nada; o lock só evita trabalho repetido entre instâncias.
 */
export async function runJobs(now = new Date()) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [JOBS_LOCK_KEY]);
    if (!rows[0]?.locked) return undefined;
    try {
      return {
        penalized: await applyPetPenalties(now),
        dueSoon: await remindDueSoon(now),
        petAlerts: await petNeeds(now),
        streakRisk: await streakAtRisk(now),
      };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [JOBS_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Liga as rotinas no processo da API. Uma falha numa rodada é registrada e a próxima tenta de novo. */
export function startScheduler() {
  const timer = setInterval(() => {
    runJobs().catch((error: unknown) => console.error(JSON.stringify({ level: 'error', message: 'jobs_failed', error: String(error) })));
  }, JOBS_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
