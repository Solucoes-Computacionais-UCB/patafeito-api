import { integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const pets = pgTable('pets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  speciesId: varchar('species_id', { length: 40 }).notNull(),
  name: varchar('name', { length: 15 }).notNull(),
  level: integer('level').notNull().default(1),
  xpTotal: integer('xp_total').notNull().default(0),
  /** Saciedade: 100 = bem alimentado. Os três status decaem com o tempo a partir de `statsUpdatedAt`. */
  hunger: integer('hunger').notNull().default(100),
  energy: integer('energy').notNull().default(100),
  happiness: integer('happiness').notNull().default(100),
  statsUpdatedAt: timestamp('stats_updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** RN02: tarefas vencidas desde a última conclusão no prazo. Com 3 ou mais, o pato fica triste. */
  overdueStreak: integer('overdue_streak').notNull().default(0),
  /** RN11: última tarefa ou ciclo de foco concluído. Nulo = conta a partir da criação do pet. */
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  /** Até quando a penalidade de inatividade já foi aplicada, para não repetir a mesma janela de 24h. */
  inactivityPenalizedAt: timestamp('inactivity_penalized_at', { withTimezone: true }),
  /** Último carinho que contou (Mimar): o próximo só vale 1 h depois. */
  lastPamperedAt: timestamp('last_pampered_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
