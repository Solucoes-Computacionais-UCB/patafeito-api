import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** AMIZADE do roteiro: um pedido por par de usuários, em qualquer direção. */
export const friendships = pgTable('friendships', {
  id: uuid('id').defaultRandom().primaryKey(),
  requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addresseeId: uuid('addressee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** pending | accepted | declined */
  status: varchar('status', { length: 10 }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('friendships_pair_unique').on(sql`least(${table.requesterId}, ${table.addresseeId})`, sql`greatest(${table.requesterId}, ${table.addresseeId})`),
  index('friendships_addressee_status_idx').on(table.addresseeId, table.status),
  check('friendships_not_self', sql`${table.requesterId} <> ${table.addresseeId}`),
]);
