import { integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 80 }).notNull(),
  /** @usuário público para amigos e busca (a-z, 0-9, _). O e-mail nunca aparece para outras pessoas. */
  handle: varchar('handle', { length: 20 }).unique(),
  /** Última requisição autenticada, gravada no máximo a cada 5 min: define "online" para os amigos. */
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  /** RN13: XP de tarefas por dia para o pato ficar feliz. */
  dailyGoalXp: integer('daily_goal_xp').notNull().default(60),
  /** Fuso IANA usado para "hoje" e "esta semana". */
  timezone: varchar('timezone', { length: 40 }).notNull().default('America/Sao_Paulo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
