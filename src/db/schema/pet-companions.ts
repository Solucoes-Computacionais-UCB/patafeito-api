import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { pets } from './pets.js';
import { users } from './users.js';

/** Cada período em que o usuário ficou com uma espécie de pato; `endedAt` nulo é o pato atual. */
export const petCompanions = pgTable('pet_companions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  petId: uuid('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  speciesId: varchar('species_id', { length: 40 }).notNull(),
  name: varchar('name', { length: 15 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (table) => [index('pet_companions_pet_started_idx').on(table.petId, table.startedAt)]);
