import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? it : it.skip;
let server: Server;
let baseUrl: string;

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  return { response, body: await response.json().catch(() => undefined) };
}

describe('pet companions integration', () => {
  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-characters-long';
    process.env.CORS_ORIGIN = 'http://localhost:8081';
    const { app } = await import('../../src/app.js');
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  integrationTest('renomeia, troca de espécie mantendo o progresso e guarda o histórico', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `ducks-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Ducks' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });
    const task = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Ganhar XP', difficulty: 'hard' }) });
    await request(`/api/v1/tasks/${task.body.data.id as string}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });

    const renamed = await request('/api/v1/pets/me', { method: 'PATCH', headers: authorization, body: JSON.stringify({ name: 'Zé' }) });
    expect(renamed.body.data.name).toBe('Zé');
    expect((await request('/api/v1/pets/me', { method: 'PATCH', headers: authorization, body: JSON.stringify({ name: 'Z' }) })).response.status).toBe(422);

    expect((await request('/api/v1/pets/me/switch', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Zé' }) })).response.status).toBe(409);
    const switched = await request('/api/v1/pets/me/switch', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'mare', name: 'Marola' }) });
    expect(switched.body.data).toMatchObject({ speciesId: 'mare', name: 'Marola', xpTotal: 40 });

    const history = (await request('/api/v1/pets/me/history', { headers: authorization })).body.data as { speciesId: string; name: string; endedAt: string | null }[];
    expect(history.map(({ speciesId, name }) => ({ speciesId, name }))).toEqual([{ speciesId: 'pingo', name: 'Zé' }, { speciesId: 'mare', name: 'Marola' }]);
    expect(history[0].endedAt).not.toBeNull();
    expect(history[1].endedAt).toBeNull();
  });
});
