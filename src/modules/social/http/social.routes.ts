import { and, eq, ilike, ne, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { friendships } from '../../../db/schema/friendships.js';
import { users } from '../../../db/schema/users.js';
import { requireAuth, type AuthenticatedRequest } from '../../../shared/auth/middleware.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { localDateKey } from '../../../shared/time/zoned.js';
import { notify } from '../../notifications/application/notify.js';
import { friendIds, friendSummaries, pairOf, periodStart, publicProfiles, relationFor } from '../application/friends.js';
import { handleSchema } from '../domain/handle.js';

const userIdParam = (value: unknown) => z.string().uuid().parse(value);
const requestInput = z.object({ handle: handleSchema });
const searchQuery = z.object({ q: z.string().trim().toLowerCase().min(3).max(20).regex(/^[a-z0-9_]+$/, 'Busque pelo @usuário: letras, números ou _.') });
const rankingQuery = z.object({ period: z.enum(['week', 'month']).default('week') });

async function displayNameOf(userId: string) {
  const [row] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId));
  return row?.displayName ?? 'Alguém';
}

/** HU32: amizades. Pedido por @usuário, aceite, recusa, desfazer e incentivo. */
export const friendsRouter = Router();
friendsRouter.use(requireAuth);

friendsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const data = await db.transaction(async (tx) => friendSummaries(tx, await friendIds(tx, req.userId!), periodStart('week')));
  res.json({ data: data.sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName)) });
});

friendsRouter.get('/requests', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const data = await db.transaction(async (tx) => {
    const mine = await tx.query.friendships.findMany({
      where: and(eq(friendships.status, 'pending'), or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))),
    });
    const profiles = new Map((await publicProfiles(tx, mine.map((row) => (row.requesterId === userId ? row.addresseeId : row.requesterId)))).map((profile) => [profile.id, profile]));
    return {
      incoming: mine.filter((row) => row.addresseeId === userId).map((row) => ({ id: row.id, createdAt: row.createdAt, user: profiles.get(row.requesterId) })),
      outgoing: mine.filter((row) => row.requesterId === userId).map((row) => ({ id: row.id, createdAt: row.createdAt, user: profiles.get(row.addresseeId) })),
    };
  });
  res.json({ data });
});

friendsRouter.post('/requests', async (req: AuthenticatedRequest, res) => {
  const { handle } = requestInput.parse(req.body);
  const userId = req.userId!;
  const result = await db.transaction(async (tx) => {
    const target = await tx.query.users.findFirst({ columns: { id: true, displayName: true }, where: eq(users.handle, handle) });
    if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'Nenhuma pessoa com esse @usuário.');
    if (target.id === userId) throw new AppError(422, 'CANNOT_ADD_SELF', 'Você não pode adicionar a si mesmo.');
    const pair = await pairOf(tx, userId, target.id);
    const relation = relationFor(userId, target.id, pair);
    if (relation === 'friend') throw new AppError(409, 'ALREADY_FRIENDS', 'Vocês já são amigos.');
    if (relation === 'outgoing') throw new AppError(409, 'REQUEST_PENDING', 'Seu pedido já foi enviado. Aguarde a resposta.');
    const me = await displayNameOf(userId);
    if (relation === 'incoming') {
      // A outra pessoa já tinha pedido: adicionar de volta é aceitar.
      const [accepted] = await tx.update(friendships).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendships.id, pair!.id)).returning();
      await notify(tx, { userId: target.id, type: 'friend_accepted', title: 'Pedido aceito!', body: `${me} agora é seu amigo no Patafeito.`, data: { userId } });
      return { status: 201, friendship: accepted };
    }
    const [created] = pair
      ? await tx.update(friendships).set({ requesterId: userId, addresseeId: target.id, status: 'pending', createdAt: new Date(), respondedAt: null }).where(eq(friendships.id, pair.id)).returning()
      : await tx.insert(friendships).values({ requesterId: userId, addresseeId: target.id }).returning();
    await notify(tx, { userId: target.id, type: 'friend_request', title: 'Pedido de amizade', body: `${me} quer ser seu amigo no Patafeito.`, data: { userId, friendshipId: created.id } });
    return { status: 201, friendship: created };
  });
  res.status(result.status).json({ data: result.friendship });
});

async function respond(userId: string, requestId: string, accept: boolean) {
  return db.transaction(async (tx) => {
    const request = await tx.query.friendships.findFirst({ where: and(eq(friendships.id, requestId), eq(friendships.addresseeId, userId), eq(friendships.status, 'pending')) });
    if (!request) throw new AppError(404, 'REQUEST_NOT_FOUND', 'Pedido de amizade não encontrado.');
    const [updated] = await tx.update(friendships).set({ status: accept ? 'accepted' : 'declined', respondedAt: new Date() }).where(eq(friendships.id, request.id)).returning();
    if (accept) {
      await notify(tx, { userId: request.requesterId, type: 'friend_accepted', title: 'Pedido aceito!', body: `${await displayNameOf(userId)} aceitou seu pedido de amizade.`, data: { userId } });
    }
    return updated;
  });
}

friendsRouter.post('/requests/:id/accept', async (req: AuthenticatedRequest, res) => {
  res.json({ data: await respond(req.userId!, userIdParam(req.params.id), true) });
});

friendsRouter.post('/requests/:id/decline', async (req: AuthenticatedRequest, res) => {
  res.json({ data: await respond(req.userId!, userIdParam(req.params.id), false) });
});

friendsRouter.delete('/:userId', async (req: AuthenticatedRequest, res) => {
  const otherId = userIdParam(req.params.userId);
  await db.transaction(async (tx) => {
    const pair = await pairOf(tx, req.userId!, otherId);
    if (!pair) throw new AppError(404, 'FRIENDSHIP_NOT_FOUND', 'Amizade não encontrada.');
    await tx.delete(friendships).where(eq(friendships.id, pair.id));
  });
  res.status(204).send();
});

/** Incentivo rápido para um amigo: uma notificação, no máximo uma por par por dia. */
friendsRouter.post('/:userId/cheer', async (req: AuthenticatedRequest, res) => {
  const otherId = userIdParam(req.params.userId);
  const userId = req.userId!;
  await db.transaction(async (tx) => {
    if (relationFor(userId, otherId, await pairOf(tx, userId, otherId)) !== 'friend') throw new AppError(403, 'NOT_FRIENDS', 'Só dá para incentivar amigos.');
    const sent = await notify(tx, {
      userId: otherId, type: 'friend_cheer', title: 'Você recebeu um incentivo!', body: `${await displayNameOf(userId)} está torcendo por você. Bora pra próxima tarefa?`,
      data: { userId }, dedupeKey: `friend_cheer:${userId}:${localDateKey(new Date())}`,
    });
    if (!sent) throw new AppError(409, 'CHEER_ALREADY_SENT', 'Você já incentivou essa pessoa hoje.');
  });
  res.status(201).json({ data: { sent: true } });
});

/** HU31: busca e perfil de outras pessoas. Fora da amizade, só o mínimo público. */
export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get('/search', async (req: AuthenticatedRequest, res) => {
  const { q } = searchQuery.parse(req.query);
  const userId = req.userId!;
  const data = await db.transaction(async (tx) => {
    const found = await tx.select({ id: users.id }).from(users)
      .where(and(ilike(users.handle, `${q.replace(/_/g, '\\_')}%`), ne(users.id, userId))).limit(20);
    const profiles = await publicProfiles(tx, found.map((row) => row.id));
    const results = [];
    for (const profile of profiles) results.push({ ...profile, online: undefined, relation: relationFor(userId, profile.id, await pairOf(tx, userId, profile.id)) });
    return results;
  });
  res.json({ data });
});

usersRouter.get('/:id/profile', async (req: AuthenticatedRequest, res) => {
  const otherId = userIdParam(req.params.id);
  const userId = req.userId!;
  const data = await db.transaction(async (tx) => {
    const relation = relationFor(userId, otherId, await pairOf(tx, userId, otherId));
    if (relation === 'friend' || relation === 'self') {
      const [summary] = await friendSummaries(tx, [otherId], periodStart('week'));
      if (!summary) throw new AppError(404, 'USER_NOT_FOUND', 'Pessoa não encontrada.');
      return { ...summary, relation };
    }
    const [profile] = await publicProfiles(tx, [otherId]);
    if (!profile) throw new AppError(404, 'USER_NOT_FOUND', 'Pessoa não encontrada.');
    // Sem amizade: nome, @usuário e o pato; nada de presença, sequência ou XP.
    return { id: profile.id, displayName: profile.displayName, handle: profile.handle, pet: profile.pet, relation };
  });
  res.json({ data });
});

/** Ranking entre amigos (e você), por XP da semana ou do mês. Não existe ranking público. */
export const rankingRouter = Router();
rankingRouter.use(requireAuth);

rankingRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { period } = rankingQuery.parse(req.query);
  const userId = req.userId!;
  const data = await db.transaction(async (tx) => {
    const summaries = await friendSummaries(tx, [userId, ...(await friendIds(tx, userId))], periodStart(period));
    return summaries
      .sort((a, b) => b.periodXp - a.periodXp || b.xpTotal - a.xpTotal)
      .map((summary, index) => ({ position: index + 1, me: summary.id === userId, ...summary }));
  });
  res.json({ data: { period, entries: data } });
});
