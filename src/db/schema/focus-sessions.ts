import { index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tasks } from './tasks.js';
import { users } from './users.js';

export const focusSessions = pgTable('focus_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  durationSeconds: integer('duration_seconds').notNull(),
  /** pomodoro | deep_work | sprint | custom: o ritmo escolhido no app. */
  mode: varchar('mode', { length: 12 }).notNull().default('pomodoro'),
  /** Tarefa em que a pessoa focou, se vinculou uma. */
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('focus_sessions_user_status_started_idx').on(table.userId, table.status, table.startedAt),
]);
