import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

// Aplica as migrações de `drizzle/` sem depender do drizzle-kit (devDependency).
// `src/db/` e `dist/db/` ficam a dois níveis da raiz do projeto.
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

try {
  await migrate(db, { migrationsFolder });
  console.log('Migrações aplicadas.');
} finally {
  await pool.end();
}
