import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';

export const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });

/** Transação Drizzle: aceita tanto `db` quanto o executor recebido em `db.transaction`. */
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
