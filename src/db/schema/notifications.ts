import { index, jsonb, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 60 }).notNull(),
  title: varchar('title', { length: 120 }).notNull(),
  body: varchar('body', { length: 300 }).notNull(),
  data: jsonb('data').notNull().default({}),
  /** Chave de deduplicação das notificações geradas por rotinas (ex.: `task_overdue:<id>`). Nula nas demais. */
  dedupeKey: varchar('dedupe_key', { length: 120 }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('notifications_user_read_created_idx').on(table.userId, table.readAt, table.createdAt),
  unique('notifications_user_dedupe_unique').on(table.userId, table.dedupeKey),
]);
