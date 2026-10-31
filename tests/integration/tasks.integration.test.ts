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
    // Os testes fazem centenas de requisições do mesmo IP em segundos: o limite de produção não vale aqui.
    process.env.RATE_LIMIT_MAX = '100000';
    process.env.AUTH_RATE_LIMIT_MAX = '100000';
    process.env.SYNC_RATE_LIMIT_MAX = '100000';
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
    expect(first.body.data.rewards).toEqual({ xp: 20, coins: 3 });
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
    expect(first.body.data.rewards).toEqual({ xp: 20, coins: 5 });
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
    expect(firstPush.body.data.results[0].data.rewards).toEqual({ xp: 40, coins: 5 });
    expect(replayPush.body.data.results[0].status).toBe('duplicate');

    // Outra operação sobre a mesma tarefa já concluída é conflito, não uma segunda recompensa.
    const secondAttempt = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [{ ...completion, opId: crypto.randomUUID() }] }) });
    expect(secondAttempt.body.data.results[0].status).toBe('conflict');

    const startedAt = new Date(Date.now() - 26 * 60 * 1000).toISOString();
    const focus = { opId: crypto.randomUUID(), type: 'focus.complete', resourceId: crypto.randomUUID(), payload: { startedAt, finishedAt: new Date().toISOString() } };
    const focusPush = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [focus] }) });
    expect(focusPush.body.data.results[0].status).toBe('applied');
    expect(focusPush.body.data.results[0].data.rewards).toEqual({ xp: 20, coins: 5 });
    const shortFocus = { opId: crypto.randomUUID(), type: 'focus.complete', resourceId: crypto.randomUUID(), payload: { startedAt: new Date(Date.now() - 60_000).toISOString(), finishedAt: new Date().toISOString() } };
    expect((await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [shortFocus] }) })).body.data.results[0].status).toBe('conflict');

    const balance = await request('/api/v1/rewards/balance', { headers: authorization });
    expect(balance.body.data).toEqual({ coins: 10, xpTotal: 60 });
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
    expect(short.body.data.results[0].data.rewards).toEqual({ xp: 12, coins: 3 });
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
    expect(completed.body.data.rewards).toEqual({ xp: 20, coins: 3 });

    const reopened = await request(`/api/v1/tasks/${taskId}/reopen`, { method: 'POST', headers: authorization });
    expect(reopened.response.status).toBe(200);
    expect(reopened.body.data.refunded).toEqual({ xp: 20, coins: 3 });
    expect(reopened.body.data.task.status).toBe('pending');
    expect(reopened.body.data.task.completedAt).toBeNull();
    expect(reopened.body.data.pet.xpTotal).toBe(0);
    expect((await request('/api/v1/rewards/balance', { headers: authorization })).body.data).toEqual({ coins: 0, xpTotal: 0 });

    // Desmarcar de novo não tem efeito, e concluir outra vez volta a creditar.
    expect((await request(`/api/v1/tasks/${taskId}/reopen`, { method: 'POST', headers: authorization })).response.status).toBe(409);
    const again = await request(`/api/v1/tasks/${taskId}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
    expect(again.response.status).toBe(200);
    expect((await request('/api/v1/rewards/balance', { headers: authorization })).body.data).toEqual({ coins: 3, xpTotal: 20 });

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

    // Tarefas difíceis valem 5 moedas: depois da compra sobram menos de 5, então a última não pode ser estornada.
    const hardTaskCoins = 5;
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

  integrationTest('busca, filtra e grava categoria e estimativa', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `search-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Busca' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });
    const created = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Relatório de física', difficulty: 'hard', category: 'study', estimatedMinutes: 90 }) });
    expect(created.response.status).toBe(201);
    expect(created.body.data).toMatchObject({ category: 'study', estimatedMinutes: 90, kind: 'normal' });
    await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Correr 5 km', difficulty: 'medium', category: 'health' }) });
    await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: '100% de 50_50', difficulty: 'easy' }) });

    const titles = async (query: string) => ((await request(`/api/v1/tasks?${query}`, { headers: authorization })).body.data as { title: string }[]).map((task) => task.title);
    expect(await titles('q=relat')).toEqual(['Relatório de física']);
    expect(await titles('q=%25')).toEqual(['100% de 50_50']);
    expect(await titles('category=health')).toEqual(['Correr 5 km']);
    await request(`/api/v1/tasks/${created.body.data.id as string}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
    expect(await titles('status=completed')).toEqual(['Relatório de física']);
    expect((await titles('status=pending')).sort()).toEqual(['100% de 50_50', 'Correr 5 km']);
  });

  integrationTest('limita tarefas especiais a 5 por semana e não dá XP por elas', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `special-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Especial' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'mare', name: 'Maré' }) });
    expect((await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Repetida', difficulty: 'easy', kind: 'special', recurrence: 'daily' }) })).response.status).toBe(422);

    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const special = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: `Evento ${index}`, difficulty: 'hard', kind: 'special' }) });
      expect(special.response.status).toBe(201);
      ids.push(special.body.data.id as string);
    }
    // Excluir não devolve a cota.
    expect((await request(`/api/v1/tasks/${ids[4]}`, { method: 'DELETE', headers: authorization })).response.status).toBe(204);
    const sixth = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Evento 6', difficulty: 'easy', kind: 'special' }) });
    expect(sixth.response.status).toBe(409);
    expect(sixth.body.error.code).toBe('SPECIAL_LIMIT_REACHED');
    const viaSync = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [{ opId: crypto.randomUUID(), type: 'task.create', resourceId: crypto.randomUUID(), payload: { title: 'Evento offline', difficulty: 'easy', kind: 'special' } }] }) });
    expect(viaSync.body.data.results[0]).toMatchObject({ status: 'conflict', code: 'SPECIAL_LIMIT_REACHED' });

    const completed = await request(`/api/v1/tasks/${ids[0]}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
    expect(completed.response.status).toBe(200);
    expect(completed.body.data.rewards).toEqual({ xp: 0, coins: 0, rareInteraction: true });
    expect(completed.body.data.pet.xpTotal).toBe(0);
  });

  integrationTest('vencidas entristecem o pato, reagendar zera o contador e a inatividade pune uma vez', async () => {
    const email = `mood-${crypto.randomUUID()}@example.test`;
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'valid-password-123', displayName: 'Humor' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'bento', name: 'Bento' }) });
    const past = new Date(Date.now() - 60_000).toISOString();
    const overdueIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      overdueIds.push((await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: `Atrasada ${index}`, difficulty: 'easy', dueAt: past }) })).body.data.id as string);
    }

    const sad = (await request('/api/v1/pets/me', { headers: authorization })).body.data;
    expect(sad).toMatchObject({ overdueStreak: 3, mood: 'sad', dailyGoal: { targetXp: 60, earnedXp: 0 } });
    expect(sad.happiness).toBeLessThanOrEqual(85);
    // Ler de novo não pune de novo.
    expect((await request('/api/v1/pets/me', { headers: authorization })).body.data.overdueStreak).toBe(3);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect((await request(`/api/v1/tasks/${overdueIds[0]}/reschedule`, { method: 'POST', headers: authorization, body: JSON.stringify({ dueAt: tomorrow }) })).response.status).toBe(200);
    expect((await request('/api/v1/pets/me', { headers: authorization })).body.data.overdueStreak).toBe(0);

    // 50h sem atividade: duas janelas de 24h, punidas uma única vez cada.
    await pool.query("UPDATE pets SET last_activity_at = now() - interval '50 hours', inactivity_penalized_at = NULL, happiness = 100, stats_updated_at = now() WHERE user_id = (SELECT id FROM users WHERE email = $1)", [email]);
    const lonely = (await request('/api/v1/pets/me', { headers: authorization })).body.data;
    expect(lonely.mood).toBe('sad');
    expect(lonely.happiness).toBe(80);
    expect((await request('/api/v1/pets/me', { headers: authorization })).body.data.happiness).toBe(80);
  });

  integrationTest('mimar é grátis, conta uma vez por hora e os cuidados pagos saíram', async () => {
    const email = `care-${crypto.randomUUID()}@example.test`;
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'valid-password-123', displayName: 'Cuidado' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });
    await pool.query('UPDATE pets SET happiness = 50, stats_updated_at = now() WHERE user_id = (SELECT id FROM users WHERE email = $1)', [email]);

    const first = await request('/api/v1/pets/me/interactions', { method: 'POST', headers: authorization, body: JSON.stringify({ type: 'pamper' }) });
    expect(first.response.status).toBe(200);
    expect(first.body.data).toMatchObject({ counted: true, pet: { happiness: 55 } });
    // Segundo toque na mesma hora: o pato reage, mas não conta; pelo sync também não.
    const second = await request('/api/v1/pets/me/interactions', { method: 'POST', headers: authorization, body: JSON.stringify({ type: 'pamper' }) });
    expect(second.body.data).toMatchObject({ counted: false, pet: { happiness: 55 } });
    const viaSync = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [
      { opId: crypto.randomUUID(), type: 'pet.interact', resourceId: crypto.randomUUID(), payload: { type: 'pamper' } },
      { opId: crypto.randomUUID(), type: 'pet.interact', resourceId: crypto.randomUUID(), payload: { type: 'play' } },
    ] }) });
    expect(viaSync.body.data.results.map((result: { status: string }) => result.status)).toEqual(['applied', 'rejected']);
    expect(viaSync.body.data.results[1].code).toBe('INTERACTION_REMOVED');

    // Uma hora depois, o carinho volta a contar. Nada disso gasta moedas.
    await pool.query("UPDATE pets SET last_pampered_at = now() - interval '61 minutes' WHERE user_id = (SELECT id FROM users WHERE email = $1)", [email]);
    const later = await request('/api/v1/pets/me/interactions', { method: 'POST', headers: authorization, body: JSON.stringify({ type: 'pamper' }) });
    expect(later.body.data.counted).toBe(true);
    expect((await request('/api/v1/pets/me/interactions', { method: 'POST', headers: authorization, body: JSON.stringify({ type: 'play' }) })).response.status).toBe(422);
    expect((await request('/api/v1/rewards/balance', { headers: authorization })).body.data.coins).toBe(0);
  });

  integrationTest('guarda o modo do foco e o vínculo só com tarefa da própria conta', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `mode-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Modo' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'mare', name: 'Maré' }) });
    const task = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Escrever TCC', difficulty: 'hard' }) });
    const linked = crypto.randomUUID();
    const foreign = crypto.randomUUID();
    const finishedAt = new Date();
    const startedAt = new Date(finishedAt.getTime() - 51 * 60_000);
    const pushed = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [
      { opId: crypto.randomUUID(), type: 'focus.complete', resourceId: linked, payload: { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationSeconds: 3000, mode: 'deep_work', taskId: task.body.data.id } },
      { opId: crypto.randomUUID(), type: 'focus.complete', resourceId: foreign, payload: { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationSeconds: 3000, mode: 'deep_work', taskId: crypto.randomUUID() } },
    ] }) });
    expect(pushed.body.data.results.map((result: { status: string }) => result.status)).toEqual(['applied', 'applied']);
    const rows = await pool.query('SELECT id, mode, task_id FROM focus_sessions WHERE id = ANY($1)', [[linked, foreign]]);
    const byId = new Map(rows.rows.map((row: { id: string; mode: string; task_id: string | null }) => [row.id, row]));
    expect(byId.get(linked)).toMatchObject({ mode: 'deep_work', task_id: task.body.data.id });
    expect(byId.get(foreign)).toMatchObject({ mode: 'deep_work', task_id: null });
  });

  integrationTest('paga o bônus de 3 dias seguidos uma única vez', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `streak-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Sequência' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'bento', name: 'Bento' }) });
    const complete = async (title: string) => {
      const task = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title, difficulty: 'easy' }) });
      const done = await request(`/api/v1/tasks/${task.body.data.id as string}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
      return { id: task.body.data.id as string, rewards: done.body.data.rewards };
    };
    // Dois dias anteriores com tarefa concluída.
    for (const daysAgo of [2, 1]) {
      const { id } = await complete(`Dia -${daysAgo}`);
      await pool.query(`UPDATE tasks SET completed_at = now() - make_interval(days => $2) WHERE id = $1`, [id, daysAgo]);
    }
    const third = await complete('Hoje');
    expect(third.rewards).toMatchObject({ xp: 10, coins: 2, streakBonus: { days: 3, xp: 10, coins: 5 } });
    const again = await complete('Hoje de novo');
    expect(again.rewards.streakBonus).toBeUndefined();
    const pet = (await request('/api/v1/pets/me', { headers: authorization })).body.data;
    expect(pet.streak).toBe(3);
    expect(pet.xpTotal).toBe(10 * 4 + 10);
    const notifications = (await request('/api/v1/notifications', { headers: authorization })).body.data as { type: string }[];
    expect(notifications.filter((item) => item.type === 'streak_bonus')).toHaveLength(1);
  });

  integrationTest('marca todas as notificações como lidas e as rotinas não repetem avisos', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `jobs-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Rotinas' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Entregar relatório', difficulty: 'medium', dueAt: soon }) });
    const late = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Pagar boleto', difficulty: 'easy', dueAt: new Date(Date.now() - 60_000).toISOString() }) });

    const { runJobs } = await import('../../src/jobs/scheduler.js');
    await runJobs();
    await runJobs();
    const listed = (await request('/api/v1/notifications', { headers: authorization })).body.data as { type: string; data: { taskId?: string }; readAt: string | null }[];
    expect(listed.filter((item) => item.type === 'task_due_soon')).toHaveLength(1);
    expect(listed.filter((item) => item.type === 'task_overdue' && item.data.taskId === late.body.data.id)).toHaveLength(1);

    const readAll = await request('/api/v1/notifications/read-all', { method: 'POST', headers: authorization });
    expect(readAll.body.data.updated).toBe(listed.length);
    const after = (await request('/api/v1/notifications', { headers: authorization })).body.data as { readAt: string | null }[];
    expect(after.every((item) => item.readAt)).toBe(true);
    const viaSync = await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [{ opId: crypto.randomUUID(), type: 'notification.read_all', payload: {} }] }) });
    expect(viaSync.body.data.results[0]).toMatchObject({ status: 'applied', data: { updated: 0 } });
  });

  integrationTest('resume a produtividade por dia, categoria e período', async () => {
    const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `stats-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Relatório' }) });
    const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
    await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });
    for (const [title, category] of [['Estudar cálculo', 'study'], ['Correr', 'health']]) {
      const task = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title, difficulty: 'medium', category }) });
      await request(`/api/v1/tasks/${task.body.data.id as string}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
    }
    const finishedAt = new Date();
    await request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [{ opId: crypto.randomUUID(), type: 'focus.complete', resourceId: crypto.randomUUID(), payload: { startedAt: new Date(finishedAt.getTime() - 26 * 60_000).toISOString(), finishedAt: finishedAt.toISOString() } }] }) });

    const overview = await request('/api/v1/stats/overview', { headers: authorization });
    expect(overview.response.status).toBe(200);
    const data = overview.body.data;
    expect(data.daily).toHaveLength(30);
    expect(data.daily[29]).toMatchObject({ date: data.to, tasks: 2, xp: 60, focusMinutes: 25 });
    expect(data.totals).toMatchObject({ tasksCompleted: 2, focusMinutes: 25, xp: 60, activeDays: 1, streak: 1, xpTotal: 60 });
    expect(data.byCategory).toEqual({ study: 1, health: 1 });
    expect((await request('/api/v1/stats/overview?from=2026-02-01&to=2026-01-01', { headers: authorization })).response.status).toBe(422);
  });

  integrationTest('amizade completa: pedido por @usuário, aceite, ranking, incentivo e privacidade', async () => {
    const person = async (name: string) => {
      const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `${name.replace(/\s+/g, '.').toLowerCase()}-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: name }) });
      const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
      await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });
      return { id: registration.body.data.user.id as string, handle: registration.body.data.user.handle as string, authorization };
    };
    const ana = await person('Ana Social');
    const bia = await person('Bia Social');
    const caio = await person('Caio Social');
    expect(ana.handle).toMatch(/^anasocial_\d{4}$/);

    // Sem amizade: o perfil mostra só o mínimo e não há incentivo.
    const stranger = (await request(`/api/v1/users/${bia.id}/profile`, { headers: ana.authorization })).body.data;
    expect(stranger).toEqual({ id: bia.id, displayName: 'Bia Social', handle: bia.handle, pet: { speciesId: 'pingo', name: 'Pingo', level: 1 }, relation: 'none' });
    expect(JSON.stringify(stranger)).not.toContain('@example.test');
    expect((await request(`/api/v1/friends/${bia.id}/cheer`, { method: 'POST', headers: ana.authorization })).response.status).toBe(403);

    const found = (await request(`/api/v1/users/search?q=${bia.handle.slice(0, 6)}`, { headers: ana.authorization })).body.data as { id: string; relation: string }[];
    expect(found.find((item) => item.id === bia.id)?.relation).toBe('none');

    const sent = await request('/api/v1/friends/requests', { method: 'POST', headers: ana.authorization, body: JSON.stringify({ handle: bia.handle }) });
    expect(sent.response.status).toBe(201);
    expect((await request('/api/v1/friends/requests', { method: 'POST', headers: ana.authorization, body: JSON.stringify({ handle: bia.handle }) })).body.error.code).toBe('REQUEST_PENDING');
    const incoming = (await request('/api/v1/friends/requests', { headers: bia.authorization })).body.data.incoming as { id: string; user: { id: string } }[];
    expect(incoming.map((item) => item.user.id)).toEqual([ana.id]);
    // Só quem recebeu pode aceitar.
    expect((await request(`/api/v1/friends/requests/${incoming[0].id}/accept`, { method: 'POST', headers: caio.authorization })).response.status).toBe(404);
    expect((await request(`/api/v1/friends/requests/${incoming[0].id}/accept`, { method: 'POST', headers: bia.authorization })).response.status).toBe(200);

    const task = await request('/api/v1/tasks', { method: 'POST', headers: bia.authorization, body: JSON.stringify({ title: 'Treinar', difficulty: 'hard' }) });
    await request(`/api/v1/tasks/${task.body.data.id as string}/complete`, { method: 'POST', headers: { ...bia.authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });

    const friends = (await request('/api/v1/friends', { headers: ana.authorization })).body.data as { id: string; periodXp: number; online: boolean }[];
    expect(friends).toHaveLength(1);
    expect(friends[0]).toMatchObject({ id: bia.id, periodXp: 40, online: true });
    const ranking = (await request('/api/v1/ranking?period=week', { headers: ana.authorization })).body.data.entries as { id: string; position: number; me: boolean }[];
    expect(ranking.map((entry) => [entry.id, entry.position, entry.me])).toEqual([[bia.id, 1, false], [ana.id, 2, true]]);
    // Caio não é amigo de ninguém: o ranking dele só tem ele mesmo.
    expect((await request('/api/v1/ranking', { headers: caio.authorization })).body.data.entries).toHaveLength(1);

    expect((await request(`/api/v1/friends/${bia.id}/cheer`, { method: 'POST', headers: ana.authorization })).response.status).toBe(201);
    expect((await request(`/api/v1/friends/${bia.id}/cheer`, { method: 'POST', headers: ana.authorization })).body.error.code).toBe('CHEER_ALREADY_SENT');
    const biaNotifications = (await request('/api/v1/notifications', { headers: bia.authorization })).body.data as { type: string }[];
    expect(biaNotifications.map((item) => item.type)).toEqual(expect.arrayContaining(['friend_request', 'friend_cheer']));

    const profile = (await request(`/api/v1/users/${bia.id}/profile`, { headers: ana.authorization })).body.data;
    expect(profile).toMatchObject({ relation: 'friend', xpTotal: 40, periodXp: 40 });
    expect((await request(`/api/v1/friends/${bia.id}`, { method: 'DELETE', headers: ana.authorization })).response.status).toBe(204);
    expect((await request('/api/v1/friends', { headers: bia.authorization })).body.data).toEqual([]);

    // Trocar o @usuário: livre aceita, ocupado recusa.
    expect((await request('/api/v1/me', { method: 'PATCH', headers: caio.authorization, body: JSON.stringify({ handle: bia.handle }) })).body.error.code).toBe('HANDLE_IN_USE');
    const newHandle = `caio_${Date.now() % 100_000}`;
    expect((await request('/api/v1/me', { method: 'PATCH', headers: caio.authorization, body: JSON.stringify({ handle: newHandle }) })).body.data.handle).toBe(newHandle);
  });
});






