import { bigserial, index, jsonb, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const syncOperations = pgTable('sync_operations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  opId: uuid('op_id').notNull(),
  operation: varchar('operation', { length: 60 }).notNull(),
  resourceId: uuid('resource_id'),
  result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique('sync_operations_user_op_unique').on(table.userId, table.opId)]);

export const syncChanges = pgTable('sync_changes', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  entityType: varchar('entity_type', { length: 40 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  changeType: varchar('change_type', { length: 12 }).notNull(),
  version: varchar('version', { length: 30 }).notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('sync_changes_user_id_idx').on(table.userId, table.id)]);
