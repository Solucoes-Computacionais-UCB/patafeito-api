import { boolean, index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { shopItems } from './shop-items.js';
import { users } from './users.js';

export const inventory = pgTable('inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  itemId: uuid('item_id').notNull().references(() => shopItems.id),
  equipped: boolean('equipped').notNull().default(false),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('inventory_user_item_unique').on(table.userId, table.itemId),
  index('inventory_user_equipped_idx').on(table.userId, table.equipped),
]);
