import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? it : it.skip;
let server: Server;
let baseUrl: string;
let pool: import('pg').Pool;

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  return { response, body: await response.json().catch(() => undefined) };
}

describe('task completion integration', () => {
  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-characters-long';
    process.env.CORS_ORIGIN = 'http://localhost:8081';
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: testDatabaseUrl });
    const tables = await pool.query("SELECT to_regclass('public.users') AS users");
    if (!tables.rows[0]?.users) throw new Error('Aplique as migrações no banco definido em TEST_DATABASE_URL antes de executar a integração.');
    await pool.query('TRUNCATE idempotency_operations, reward_ledger, focus_sessions, tasks, pets, refresh_tokens, users CASCADE');
    const { app } = await import('../../src/app.js');
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Não foi possível iniciar o servidor de teste.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  });

  integrationTest('conclui uma tarefa uma vez e repete a resposta para a mesma chave', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `integration-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Integration' }) });
    expect(registration.response.status).toBe(201);
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    const refreshToken = registration.body.data.tokens.refreshToken as string;
    const refresh = await request('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) });
    expect(refresh.response.status).toBe(200);
    expect((await request('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) })).response.status).toBe(401);
    expect((await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'cat', name: 'Luna' }) })).response.status).toBe(201);
    const task = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Estudar', difficulty: 'medium' }) });
    const key = crypto.randomUUID();
    const headers = { ...authorization, 'idempotency-key': key };
    const first = await request(`/api/v1/tasks/${task.body.data.id as string}/complete`, { method: 'POST', headers, body: '{}' });
    const second = await request(`/api/v1/tasks/${task.body.data.id as string}/complete`, { method: 'POST', headers, body: '{}' });

    expect(first.response.status).toBe(200);
    expect(first.body.data.rewards).toEqual({ xp: 20, coins: 4 });
    expect(second.body.data).toEqual(first.body.data);
    expect((await request(`/api/v1/tasks/${task.body.data.id as string}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' })).response.status).toBe(409);
  });

  integrationTest('recompensa uma sessão Pomodoro integral apenas uma vez', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `focus-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Focus' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'dog', name: 'Nino' }) });
    const started = await request('/api/v1/focus-sessions', { method: 'POST', headers: authorization });
    expect(started.response.status).toBe(201);
    const sessionId = started.body.data.id as string;
    expect((await request(`/api/v1/focus-sessions/${sessionId}/finish`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() } })).response.status).toBe(409);
    await pool.query("UPDATE focus_sessions SET started_at = now() - interval '25 minutes' WHERE id = $1", [sessionId]);
    const key = crypto.randomUUID();
    const headers = { ...authorization, 'idempotency-key': key };
    const first = await request(`/api/v1/focus-sessions/${sessionId}/finish`, { method: 'POST', headers });
    const second = await request(`/api/v1/focus-sessions/${sessionId}/finish`, { method: 'POST', headers });
    expect(first.response.status).toBe(200);
    expect(first.body.data.rewards).toEqual({ xp: 20, coins: 4 });
    expect(second.body.data).toEqual(first.body.data);
    const notifications = await request('/api/v1/notifications', { headers: authorization });
    expect(notifications.response.status).toBe(200);
    const notificationId = notifications.body.data[0].id as string;
    const read = await request(`/api/v1/notifications/${notificationId}`, { method: 'PATCH', headers: authorization, body: JSON.stringify({ read: true }) });
    expect(read.body.data.readAt).toBeTruthy();
  });

  integrationTest('compra e equipa um cosmético do inventário', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `shop-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Shop' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    const userId = registration.body.data.user.id as string;
    await pool.query('INSERT INTO reward_ledger (user_id, source_type, source_id, xp_delta, coin_delta) VALUES ($1, $2, $3, 0, 20)', [userId, 'test_credit', crypto.randomUUID()]);
    const catalog = await request('/api/v1/shop/items', { headers: authorization });
    expect(catalog.response.status).toBe(200);
    const itemId = catalog.body.data[0].id as string;
    const headers = { ...authorization, 'idempotency-key': crypto.randomUUID() };
    const purchase = await request('/api/v1/shop/purchases', { method: 'POST', headers, body: JSON.stringify({ itemId }) });
    expect(purchase.response.status).toBe(201);
    expect(purchase.body.data.balanceCoins).toBe(10);
    expect((await request('/api/v1/shop/purchases', { method: 'POST', headers, body: JSON.stringify({ itemId }) })).body.data).toEqual(purchase.body.data);
    const equipped = await request('/api/v1/inventory', { method: 'PATCH', headers: authorization, body: JSON.stringify({ itemId }) });
    expect(equipped.response.status).toBe(200);
    expect(equipped.body.data.equipped).toBe(true);
  });

  integrationTest('sincroniza criação de tarefa com idempotência e cursor', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `sync-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Sync' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    const operation = { opId: crypto.randomUUID(), type: 'task.create', payload: { title: 'Offline', difficulty: 'easy' } };
    const first = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [operation] }) });
    const second = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [operation] }) });
    expect(first.body.data.results[0].status).toBe('applied');
    expect(second.body.data.results[0].status).toBe('duplicate');
    const snapshot = await request('/api/v1/sync/pull', { headers: authorization });
    expect(snapshot.body.data.snapshot).toBe(true);
    expect(snapshot.body.data.changes.some((change: { entityType: string }) => change.entityType === 'task')).toBe(true);
  });
});
