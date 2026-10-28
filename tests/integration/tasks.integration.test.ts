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
    expect(first.body.data.rewards).toEqual({ xp: 20, coins: 2 });
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
    // 26 minutos: a margem evita falso negativo quando o relógio do banco está alguns milissegundos à frente.
    await pool.query("UPDATE focus_sessions SET started_at = now() - interval '26 minutes' WHERE id = $1", [sessionId]);
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
    // Cosmético equipável: o cenário mais barato (os consumíveis vêm antes no catálogo).
    const scene = (catalog.body.data as { id: string; slot: string; priceCoins: number }[]).find((item) => item.slot === 'background')!;
    const itemId = scene.id;
    const headers = { ...authorization, 'idempotency-key': crypto.randomUUID() };
    const purchase = await request('/api/v1/shop/purchases', { method: 'POST', headers, body: JSON.stringify({ itemId }) });
    expect(purchase.response.status).toBe(201);
    expect(purchase.body.data.balanceCoins).toBe(20 - scene.priceCoins);
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

  integrationTest('conclui tarefa e sessão de foco offline sem conceder XP duas vezes', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `offline-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Offline' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });
    const created = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Tarefa offline', difficulty: 'hard' }) });
    const taskId = created.body.data.id as string;

    const completion = { opId: crypto.randomUUID(), type: 'task.complete', resourceId: taskId, payload: { completedAt: new Date().toISOString() } };
    const firstPush = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [completion] }) });
    const replayPush = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [completion] }) });
    expect(firstPush.body.data.results[0].status).toBe('applied');
    expect(firstPush.body.data.results[0].data.rewards).toEqual({ xp: 40, coins: 3 });
    expect(replayPush.body.data.results[0].status).toBe('duplicate');

    // Outra operação sobre a mesma tarefa já concluída é conflito, não uma segunda recompensa.
    const secondAttempt = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [{ ...completion, opId: crypto.randomUUID() }] }) });
    expect(secondAttempt.body.data.results[0].status).toBe('conflict');

    const startedAt = new Date(Date.now() - 26 * 60 * 1000).toISOString();
    const focus = { opId: crypto.randomUUID(), type: 'focus.complete', resourceId: crypto.randomUUID(), payload: { startedAt, finishedAt: new Date().toISOString() } };
    const focusPush = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [focus] }) });
    expect(focusPush.body.data.results[0].status).toBe('applied');
    expect(focusPush.body.data.results[0].data.rewards).toEqual({ xp: 20, coins: 4 });
    const shortFocus = { opId: crypto.randomUUID(), type: 'focus.complete', resourceId: crypto.randomUUID(), payload: { startedAt: new Date(Date.now() - 60_000).toISOString(), finishedAt: new Date().toISOString() } };
    expect((await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [shortFocus] }) })).body.data.results[0].status).toBe('conflict');

    const balance = await request('/api/v1/rewards/balance', { headers: authorization });
    expect(balance.body.data).toEqual({ coins: 7, xpTotal: 60 });
  });

  integrationTest('registra ciclos de foco com duração escolhida e recompensa proporcional', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `rhythm-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Rhythm' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });
    const push = (startedMinutesAgo: number, durationSeconds: number) => request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [{
      opId: crypto.randomUUID(), type: 'focus.complete', resourceId: crypto.randomUUID(),
      payload: { startedAt: new Date(Date.now() - startedMinutesAgo * 60_000).toISOString(), finishedAt: new Date().toISOString(), durationSeconds },
    }] }) });

    const short = await push(16, 15 * 60);
    expect(short.body.data.results[0].data.rewards).toEqual({ xp: 12, coins: 2 });
    expect(short.body.data.results[0].data.session.durationSeconds).toBe(15 * 60);
    // O período precisa cobrir a duração declarada: 30 minutos não fecham um ciclo longo de 50.
    expect((await push(30, 50 * 60)).body.data.results[0].status).toBe('conflict');
    expect((await push(200, 180 * 60)).response.status).toBe(422);

    const started = await request('/api/v1/focus-sessions', { method: 'POST', headers: authorization, body: JSON.stringify({ durationSeconds: 50 * 60 }) });
    expect(started.body.data.durationSeconds).toBe(50 * 60);
  });

  integrationTest('desmarca uma tarefa, estorna a recompensa e permite concluir de novo', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `reopen-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Reopen' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'bento', name: 'Bento' }) });
    const created = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Arrumar a mesa', difficulty: 'medium' }) });
    const taskId = created.body.data.id as string;

    const completed = await request(`/api/v1/tasks/${taskId}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
    expect(completed.body.data.rewards).toEqual({ xp: 20, coins: 2 });

    const reopened = await request(`/api/v1/tasks/${taskId}/reopen`, { method: 'POST', headers: authorization });
    expect(reopened.response.status).toBe(200);
    expect(reopened.body.data.refunded).toEqual({ xp: 20, coins: 2 });
    expect(reopened.body.data.task.status).toBe('pending');
    expect(reopened.body.data.task.completedAt).toBeNull();
    expect(reopened.body.data.pet.xpTotal).toBe(0);
    expect((await request('/api/v1/rewards/balance', { headers: authorization })).body.data).toEqual({ coins: 0, xpTotal: 0 });

    // Desmarcar de novo não tem efeito, e concluir outra vez volta a creditar.
    expect((await request(`/api/v1/tasks/${taskId}/reopen`, { method: 'POST', headers: authorization })).response.status).toBe(409);
    const again = await request(`/api/v1/tasks/${taskId}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
    expect(again.response.status).toBe(200);
    expect((await request('/api/v1/rewards/balance', { headers: authorization })).body.data).toEqual({ coins: 2, xpTotal: 20 });

    // Pela fila offline o caminho é o mesmo.
    const operation = { opId: crypto.randomUUID(), type: 'task.reopen', resourceId: taskId, payload: {} };
    const push = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [operation] }) });
    expect(push.body.data.results[0].status).toBe('applied');
    expect((await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [operation] }) })).body.data.results[0].status).toBe('duplicate');
    expect((await request('/api/v1/rewards/balance', { headers: authorization })).body.data).toEqual({ coins: 0, xpTotal: 0 });
  });

  integrationTest('guarda a repetição da tarefa e recusa recriar uma repetição excluída', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `repeat-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Repeat' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    expect((await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Sem dia', difficulty: 'easy', recurrence: 'weekly' }) })).response.status).toBe(422);

    const seriesId = crypto.randomUUID();
    const occurrence = { opId: crypto.randomUUID(), type: 'task.create', resourceId: seriesId, payload: { title: 'Planejar a semana', difficulty: 'medium', dueAt: new Date(Date.now() + 86_400_000).toISOString(), recurrence: 'weekly', recurrenceDay: 1, seriesId } };
    const created = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [occurrence] }) });
    expect(created.body.data.results[0].data).toMatchObject({ id: seriesId, recurrence: 'weekly', recurrenceDay: 1, seriesId });

    await request(`/api/v1/tasks/${seriesId}`, { method: 'DELETE', headers: authorization });
    const recreated = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [{ ...occurrence, opId: crypto.randomUUID() }] }) });
    expect(recreated.body.data.results[0].status).toBe('conflict');
  });

  integrationTest('recusa desmarcar quando as moedas da tarefa já foram gastas', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `spent-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Spent' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });

    // O catálogo vem do banco: o teste junta só o bastante para o item mais barato.
    const catalog = await request('/api/v1/shop/items', { headers: authorization });
    const cheapest = (catalog.body.data as { id: string; priceCoins: number }[])[0];
    expect(cheapest).toBeTruthy();

    // Tarefas difíceis valem 3 moedas: depois da compra sobram menos de 3, então a última não pode ser estornada.
    const hardTaskCoins = 3;
    let taskId = '';
    for (let paid = 0; paid < cheapest.priceCoins; paid += hardTaskCoins) {
      const created = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: `Tarefa paga ${paid / hardTaskCoins + 1}`, difficulty: 'hard' }) });
      taskId = created.body.data.id as string;
      const completed = await request(`/api/v1/tasks/${taskId}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
      expect(completed.body.data.rewards.coins).toBe(hardTaskCoins);
    }

    const purchase = await request('/api/v1/shop/purchases', { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ itemId: cheapest.id }) });
    expect(purchase.response.status).toBe(201);
    expect(purchase.body.data.balanceCoins).toBeLessThan(hardTaskCoins);

    const reopened = await request(`/api/v1/tasks/${taskId}/reopen`, { method: 'POST', headers: authorization });
    expect(reopened.response.status).toBe(409);
    expect(reopened.body.error.code).toBe('COINS_ALREADY_SPENT');
  });

  integrationTest('tarefa vencida aceita só reagendamento pelo sync', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `overdue-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Vencida' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    const push = (operations: unknown[]) => request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations }) });
    const taskId = crypto.randomUUID();
    await push([{ opId: crypto.randomUUID(), type: 'task.create', resourceId: taskId, payload: { title: 'Atrasada', difficulty: 'easy', dueAt: new Date(Date.now() - 86_400_000).toISOString() } }]);

    const edited = await push([{ opId: crypto.randomUUID(), type: 'task.update', resourceId: taskId, baseVersion: 1, payload: { title: 'Outro título' } }]);
    expect(edited.body.data.results[0]).toMatchObject({ status: 'conflict', code: 'TASK_OVERDUE' });
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const rescheduled = await push([{ opId: crypto.randomUUID(), type: 'task.update', resourceId: taskId, baseVersion: 1, payload: { dueAt: future } }]);
    expect(rescheduled.body.data.results[0].status).toBe('applied');
    expect(new Date(rescheduled.body.data.results[0].data.dueAt as string).toISOString()).toBe(future);
  });
});
