import { integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const pets = pgTable('pets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  speciesId: varchar('species_id', { length: 40 }).notNull(),
  name: varchar('name', { length: 15 }).notNull(),
  level: integer('level').notNull().default(1),
  xpTotal: integer('xp_total').notNull().default(0),
  health: integer('health').notNull().default(100),
  hunger: integer('hunger').notNull().default(100),
  happiness: integer('happiness').notNull().default(100),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
