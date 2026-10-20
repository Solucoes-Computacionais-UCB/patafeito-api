import { boolean, integer, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';

export const shopItems = pgTable('shop_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  sku: varchar('sku', { length: 60 }).notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  description: varchar('description', { length: 300 }).notNull(),
  slot: varchar('slot', { length: 30 }).notNull(),
  priceCoins: integer('price_coins').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique('shop_items_sku_unique').on(table.sku)]);
