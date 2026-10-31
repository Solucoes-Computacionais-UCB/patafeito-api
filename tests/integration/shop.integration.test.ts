import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? it : it.skip;
let server: Server;
let baseUrl: string;
let pool: import('pg').Pool;

type CatalogItem = { id: string; sku: string; slot: string; priceCoins: number; consumable: boolean };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  return { response, body: await response.json().catch(() => undefined) };
}

/** Usuário com pet e moedas creditadas direto no razão. */
/** `level` alto por padrão: os testes de compra não dependem do bloqueio por nível (RN12). */
async function shopper(coins: number, level = 6) {
  const registration = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `buyer-${crypto.randomUUID()}@example.test`, password: 'valid-password-123', displayName: 'Buyer' }) });
  const authorization = { authorization: `Bearer ${registration.body.data.tokens.accessToken as string}` };
  await pool.query('INSERT INTO reward_ledger (user_id, source_type, source_id, xp_delta, coin_delta) VALUES ($1, $2, $3, 0, $4)', [registration.body.data.user.id, 'test_credit', crypto.randomUUID(), coins]);
  await request('/api/v1/pets/me', { method: 'POST', headers: authorization, body: JSON.stringify({ speciesId: 'pingo', name: 'Pingo' }) });
  const xpForLevel = [0, 0, 100, 300, 600, 1000, 1500][level];
  await pool.query('UPDATE pets SET xp_total = $2, level = $3 WHERE user_id = $1', [registration.body.data.user.id, xpForLevel, level]);
  const catalog = (await request('/api/v1/shop/items', { headers: authorization })).body.data as CatalogItem[];
  const item = (sku: string) => catalog.find((entry) => entry.sku === sku)!;
  const buy = (sku: string) => request('/api/v1/shop/purchases', { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ itemId: item(sku).id }) });
  const use = (sku: string, extra: Record<string, unknown> = {}) => request('/api/v1/inventory/use', { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ itemId: item(sku).id, ...extra }) });
  return { userId: registration.body.data.user.id as string, authorization, catalog, item, buy, use };
}

describe('shop integration', () => {
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
    const { app } = await import('../../src/app.js');
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (pool) await pool.end();
  });

  integrationTest('lista só comidas, poderes e cenários', async () => {
    const { catalog } = await shopper(0);
    expect(new Set(catalog.map((entry) => entry.slot))).toEqual(new Set(['food', 'power', 'background']));
    expect(catalog.filter((entry) => entry.slot === 'food').every((entry) => entry.consumable)).toBe(true);
  });

  integrationTest('acumula comida, alimenta o pato e gasta a unidade', async () => {
    const { userId, authorization, buy, use } = await shopper(50);
    await buy('food-fish');
    const second = await buy('food-fish');
    expect(second.body.data.inventoryItem.quantity).toBe(2);
    expect(second.body.data.balanceCoins).toBe(34);

    // Um pato com fome: 40 de saciedade agora.
    await pool.query('UPDATE pets SET hunger = 40, stats_updated_at = now() WHERE user_id = $1', [userId]);
    const fed = await use('food-fish');
    expect(fed.body.data.inventoryItem.quantity).toBe(1);
    expect(fed.body.data.pet.hunger).toBeGreaterThanOrEqual(84);

    await use('food-fish');
    expect((await use('food-fish')).response.status).toBe(404);
    expect((await request('/api/v1/pets/me', { headers: authorization })).body.data.happiness).toBe(100);
  });

  integrationTest('poção dobra o XP e o trevo dobra as moedas das tarefas', async () => {
    const { authorization, buy, use } = await shopper(60);
    await buy('power-double-xp');
    await buy('power-lucky-clover');
    const potion = await use('power-double-xp');
    expect(new Date(potion.body.data.boost.expiresAt).getTime() - Date.now()).toBeGreaterThan(110 * 60_000);
    await use('power-lucky-clover');

    const task = await request('/api/v1/tasks', { method: 'POST', headers: authorization, body: JSON.stringify({ title: 'Com bônus', difficulty: 'hard' }) });
    const completed = await request(`/api/v1/tasks/${task.body.data.id as string}/complete`, { method: 'POST', headers: { ...authorization, 'idempotency-key': crypto.randomUUID() }, body: '{}' });
    expect(completed.body.data.rewards).toEqual({ xp: 80, coins: 10 });

    const boosts = (await request('/api/v1/inventory/boosts', { headers: authorization })).body.data as { active: { effect: string }[] };
    expect(boosts.active.map((boost) => boost.effect).sort()).toEqual(['double_coins', 'double_xp']);
  });

  integrationTest('ampulheta dobra só o próximo ciclo de foco', async () => {
    const { authorization, buy, use } = await shopper(20);
    await buy('power-focus-hourglass');
    await use('power-focus-hourglass');
    const focus = () => request('/api/v1/sync/push', { method: 'POST', headers: authorization, body: JSON.stringify({ operations: [{
      opId: crypto.randomUUID(), type: 'focus.complete', resourceId: crypto.randomUUID(),
      payload: { startedAt: new Date(Date.now() - 26 * 60_000).toISOString(), finishedAt: new Date().toISOString() },
    }] }) });
    expect((await focus()).body.data.results[0].data.rewards).toEqual({ xp: 40, coins: 10 });
    expect((await focus()).body.data.results[0].data.rewards).toEqual({ xp: 20, coins: 5 });
  });

  integrationTest('escudo protege o dia de hoje uma única vez', async () => {
    const { authorization, buy, use } = await shopper(60);
    await buy('power-streak-shield');
    await buy('power-streak-shield');
    const today = new Date().toISOString().slice(0, 10);
    expect((await use('power-streak-shield')).response.status).toBe(422);
    expect((await use('power-streak-shield', { localDate: '2020-01-01' })).response.status).toBe(422);
    expect((await use('power-streak-shield', { localDate: today })).response.status).toBe(200);
    expect((await use('power-streak-shield', { localDate: today })).response.status).toBe(409);
    const boosts = (await request('/api/v1/inventory/boosts', { headers: authorization })).body.data as { protectedDates: string[] };
    expect(boosts.protectedDates).toEqual([today]);
  });

  integrationTest('bloqueia itens acima do nível do pet (RN12)', async () => {
    const { item, buy } = await shopper(100, 2);
    expect(item('scene-noite').minLevel).toBe(5);
    const locked = await buy('scene-noite');
    expect(locked.response.status).toBe(409);
    expect(locked.body.error.code).toBe('ITEM_LOCKED');
    expect((await buy('scene-lago')).response.status).toBe(201);
    expect((await buy('power-lucky-clover')).response.status).toBe(201);
  });

  integrationTest('cenário é comprado uma vez, equipado e tirado', async () => {
    const { authorization, item, buy, use } = await shopper(100);
    expect((await buy('scene-lago')).response.status).toBe(201);
    expect((await buy('scene-lago')).response.status).toBe(409);
    expect((await use('scene-lago')).response.status).toBe(409);
    await buy('scene-noite');

    const equip = (sku: string, equipped = true) => request('/api/v1/inventory', { method: 'PATCH', headers: authorization, body: JSON.stringify({ itemId: item(sku).id, equipped }) });
    await equip('scene-lago');
    await equip('scene-noite');
    const owned = (await request('/api/v1/inventory', { headers: authorization })).body.data as { inventory: { equipped: boolean }; item: { sku: string } }[];
    expect(owned.filter((row) => row.inventory.equipped).map((row) => row.item.sku)).toEqual(['scene-noite']);
    expect((await equip('scene-noite', false)).body.data.equipped).toBe(false);
  });
});
