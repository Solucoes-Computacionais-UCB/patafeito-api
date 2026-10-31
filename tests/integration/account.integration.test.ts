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

async function register() {
  const email = `account-${crypto.randomUUID()}@example.test`;
  const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'valid-password-123', displayName: 'Conta' }) });
  return { email, tokens: registration.body.data.tokens as { accessToken: string; refreshToken: string }, authorization: { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` } };
}

describe('account integration', () => {
  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-characters-long';
    process.env.CORS_ORIGIN = 'http://localhost:8081';
    // Os testes fazem centenas de requisições do mesmo IP em segundos: o limite de produção não vale aqui.
    process.env.RATE_LIMIT_MAX = '100000';
    process.env.AUTH_RATE_LIMIT_MAX = '100000';
    process.env.SYNC_RATE_LIMIT_MAX = '100000';
    const { app } = await import('../../src/app.js');
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  integrationTest('edita nome livremente e exige a senha para trocar o e-mail', async () => {
    const { authorization } = await register();
    const renamed = await request('/api/v1/me', { method: 'PATCH', headers: authorization, body: JSON.stringify({ displayName: 'Novo Nome' }) });
    expect(renamed.body.data.displayName).toBe('Novo Nome');

    const newEmail = `moved-${crypto.randomUUID()}@example.test`;
    const withoutPassword = await request('/api/v1/me', { method: 'PATCH', headers: authorization, body: JSON.stringify({ email: newEmail }) });
    expect(withoutPassword.response.status).toBe(403);
    const moved = await request('/api/v1/me', { method: 'PATCH', headers: authorization, body: JSON.stringify({ email: newEmail, currentPassword: 'valid-password-123' }) });
    expect(moved.body.data.email).toBe(newEmail);
    expect((await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: newEmail, password: 'valid-password-123' }) })).response.status).toBe(200);

    const other = await register();
    const taken = await request('/api/v1/me', { method: 'PATCH', headers: other.authorization, body: JSON.stringify({ email: newEmail, currentPassword: 'valid-password-123' }) });
    expect(taken.response.status).toBe(409);
  });

  integrationTest('troca a senha e encerra as outras sessões', async () => {
    const { email, tokens, authorization } = await register();
    const wrong = await request('/api/v1/me/password', { method: 'POST', headers: authorization, body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'another-password-456' }) });
    expect(wrong.response.status).toBe(403);
    const changed = await request('/api/v1/me/password', { method: 'POST', headers: authorization, body: JSON.stringify({ currentPassword: 'valid-password-123', newPassword: 'another-password-456' }) });
    expect(changed.body.data.tokens.refreshToken).toBeTruthy();

    expect((await request('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: tokens.refreshToken }) })).response.status).toBe(401);
    expect((await request('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: changed.body.data.tokens.refreshToken }) })).response.status).toBe(200);
    expect((await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'valid-password-123' }) })).response.status).toBe(401);
    expect((await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'another-password-456' }) })).response.status).toBe(200);
  });

  integrationTest('reseta o progresso mantendo o pet e as tarefas pendentes', async () => {
    const { authorization } = await register();
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });
    const done = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Feita', difficulty: 'hard' }) });
    const pending = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Pendente', difficulty: 'easy' }) });
    await request(`/api/v1/tasks/${done.body.data.id as string}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
    expect((await request('/api/v1/rewards/balance', { headers: authorization })).body.data).toEqual({ coins: 5, xpTotal: 40 });

    expect((await request('/api/v1/me/reset-progress', { method: 'POST', headers: authorization, body: JSON.stringify({ currentPassword: 'nope' }) })).response.status).toBe(403);
    const reset = await request('/api/v1/me/reset-progress', { method: 'POST', headers: authorization, body: JSON.stringify({ currentPassword: 'valid-password-123' }) });
    expect(reset.body.data.pet).toMatchObject({ name: 'Pingo', level: 1, xpTotal: 0, hunger: 100, energy: 100, happiness: 100 });

    expect((await request('/api/v1/rewards/balance', { headers: authorization })).body.data).toEqual({ coins: 0, xpTotal: 0 });
    const remaining = (await request('/api/v1/tasks', { headers: authorization })).body.data as { id: string }[];
    expect(remaining.map((task) => task.id)).toEqual([pending.body.data.id]);
  });

  integrationTest('exclui a conta com todos os dados e libera o e-mail', async () => {
    const { email, tokens, authorization } = await register();
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'mare', name: 'Maré' }) });
    const task = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Feita', difficulty: 'easy' }) });
    await request(`/api/v1/tasks/${task.body.data.id as string}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
    await request('/api/v1/focus-sessions', { method: 'POST', headers: authorization, body: '{}' });

    expect((await request('/api/v1/me', { method: 'DELETE', headers: authorization, body: JSON.stringify({ currentPassword: 'nope' }) })).response.status).toBe(403);
    expect((await request('/api/v1/me', { method: 'DELETE', headers: authorization, body: JSON.stringify({ currentPassword: 'valid-password-123' }) })).response.status).toBe(204);

    expect((await request('/api/v1/me', { headers: authorization })).response.status).toBe(404);
    expect((await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'valid-password-123' }) })).response.status).toBe(401);
    expect((await request('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: tokens.refreshToken }) })).response.status).toBe(401);
    const again = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'valid-password-123', displayName: 'De novo' }) });
    expect(again.response.status).toBe(201);
  });
});
