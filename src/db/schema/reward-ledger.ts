import { index, integer, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const rewardLedger = pgTable('reward_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  sourceType: varchar('source_type', { length: 40 }).notNull(),
  sourceId: uuid('source_id').notNull(),
  xpDelta: integer('xp_delta').notNull(),
  coinDelta: integer('coin_delta').notNull().default(0),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('reward_ledger_source_user_unique').on(table.sourceType, table.sourceId, table.userId),
  index('reward_ledger_user_occurred_idx').on(table.userId, table.occurredAt),
]);
