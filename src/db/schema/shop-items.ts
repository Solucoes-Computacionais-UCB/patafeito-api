import { boolean, integer, jsonb, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';

/** O que o item faz ao ser usado (consumíveis) ou equipado (cenários). Ver modules/shop/domain/items.ts. */
export type ItemEffect =
  | { type: 'stats'; hunger?: number; energy?: number; happiness?: number }
  | { type: 'double_xp'; hours: number }
  | { type: 'double_coins'; hours: number }
  | { type: 'focus_double' }
  | { type: 'streak_shield' }
  | { type: 'background' }
  | { type: 'none' };

export const shopItems = pgTable('shop_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  sku: varchar('sku', { length: 60 }).notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  description: varchar('description', { length: 300 }).notNull(),
  /** Categoria na loja: food, power, background ou accessory. Itens equipáveis trocam um por categoria. */
  slot: varchar('slot', { length: 30 }).notNull(),
  priceCoins: integer('price_coins').notNull(),
  /** Consumíveis acumulam quantidade e somem ao usar; os demais são comprados uma vez. */
  consumable: boolean('consumable').notNull().default(false),
  effect: jsonb('effect').$type<ItemEffect>().notNull().default({ type: 'none' }),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique('shop_items_sku_unique').on(table.sku)]);
