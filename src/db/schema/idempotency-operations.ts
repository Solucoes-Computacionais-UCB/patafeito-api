import { index, jsonb, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const idempotencyOperations = pgTable('idempotency_operations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: uuid('key').notNull(),
  operation: varchar('operation', { length: 60 }).notNull(),
  resourceId: uuid('resource_id').notNull(),
  response: jsonb('response').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('idempotency_operations_user_key_unique').on(table.userId, table.key),
  index('idempotency_operations_resource_idx').on(table.userId, table.operation, table.resourceId),
]);
