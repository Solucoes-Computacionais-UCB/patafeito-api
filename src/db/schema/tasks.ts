import { index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  title: varchar('title', { length: 200 }).notNull(),
  description: varchar('description', { length: 2000 }),
  difficulty: varchar('difficulty', { length: 12 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  /** personal | work | study | health | career. */
  category: varchar('category', { length: 20 }).notNull().default('personal'),
  estimatedMinutes: integer('estimated_minutes'),
  /** normal | special. Especiais não rendem XP e têm limite semanal (RN14). */
  kind: varchar('kind', { length: 10 }).notNull().default('normal'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  /** Quando a penalidade de vencimento (RN02) foi aplicada; zera ao reagendar. */
  overdueProcessedAt: timestamp('overdue_processed_at', { withTimezone: true }),
  /** daily | weekly | monthly. Cada repetição é uma tarefa própria; o app gera a próxima. */
  recurrence: varchar('recurrence', { length: 10 }),
  /** Dia da semana (0 = domingo) nas semanais; dia do mês (1–31) nas mensais. */
  recurrenceDay: integer('recurrence_day'),
  /** Id da primeira tarefa da série, compartilhado por todas as repetições. */
  seriesId: uuid('series_id'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('tasks_user_status_due_idx').on(table.userId, table.status, table.dueAt),
  index('tasks_user_kind_created_idx').on(table.userId, table.kind, table.createdAt),
]);
