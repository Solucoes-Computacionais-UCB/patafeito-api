import { index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { shopItems } from './shop-items.js';
import { users } from './users.js';

/**
 * Efeitos de poderes já usados. `expiresAt` marca os de tempo (XP e moedas em dobro);
 * `usesLeft` os de uso único (próximo ciclo de foco); `protectedDate` o dia salvo pelo escudo.
 */
export const activeBoosts = pgTable('active_boosts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => shopItems.id),
  effect: varchar('effect', { length: 30 }).notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  usesLeft: integer('uses_left'),
  /** Dia local (AAAA-MM-DD) que conta para a sequência mesmo sem tarefa concluída. */
  protectedDate: varchar('protected_date', { length: 10 }),
}, (table) => [index('active_boosts_user_effect_idx').on(table.userId, table.effect)]);
