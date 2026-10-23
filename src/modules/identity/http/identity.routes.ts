import argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { users } from '../../../db/schema/users.js';
import { refreshTokens } from '../../../db/schema/refresh-tokens.js';
import { AppError } from '../../../shared/errors/app-error.js';

export const identityRouter = Router();
const credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(128) });
const registerInput = credentials.extend({ displayName: z.string().trim().min(2).max(80) });
const refreshTokenLifetimeMs = 30 * 24 * 60 * 60 * 1000;
type DatabaseExecutor = Pick<typeof db, 'insert'>;

export const issueTokens = async (userId: string, executor: DatabaseExecutor = db) => {
  const refreshTokenId = crypto.randomUUID();
  const refreshToken = jwt.sign({}, env.JWT_REFRESH_SECRET, { subject: userId, jwtid: refreshTokenId, expiresIn: '30d' });
  await executor.insert(refreshTokens).values({
    id: refreshTokenId,
    userId,
    tokenHash: await argon2.hash(refreshToken, { type: argon2.argon2id }),
    expiresAt: new Date(Date.now() + refreshTokenLifetimeMs),
  });
  return { accessToken: jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: '15m' }), refreshToken };
};

identityRouter.post('/register', async (req, res) => {
  const input = registerInput.parse(req.body);
  const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (existing) throw new AppError(409, 'EMAIL_IN_USE', 'Este e-mail já está em uso.');
  const [user] = await db.insert(users).values({ email: input.email, displayName: input.displayName, passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }) }).returning({ id: users.id, email: users.email, displayName: users.displayName });
  res.status(201).json({ data: { user, tokens: await issueTokens(user.id) } });
});

identityRouter.post('/login', async (req, res) => {
  const input = credentials.parse(req.body);
  const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (!user || !(await argon2.verify(user.passwordHash, input.password))) throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
  res.json({ data: { user: { id: user.id, email: user.email, displayName: user.displayName }, tokens: await issueTokens(user.id) } });
});

identityRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
  try {
    const { sub, jti } = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string; jti: string };
    if (!sub || !jti) throw new Error('Refresh token sem identificador.');
    const token = await db.query.refreshTokens.findFirst({ where: eq(refreshTokens.id, jti) });
    if (!token || token.userId !== sub || token.revokedAt || token.expiresAt <= new Date() || !(await argon2.verify(token.tokenHash, refreshToken))) throw new Error('Refresh token inválido.');
    const tokens = await db.transaction(async (tx) => {
      const [revoked] = await tx.update(refreshTokens).set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, jti), eq(refreshTokens.userId, sub), isNull(refreshTokens.revokedAt))).returning({ id: refreshTokens.id });
      if (!revoked) throw new Error('Refresh token já utilizado.');
      return issueTokens(sub, tx);
    });
    res.json({ data: { tokens } });
  }
  catch { throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token inválido ou expirado.'); }
});

identityRouter.post('/logout', async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
  try {
    const { sub, jti } = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string; jti: string };
    if (sub && jti) await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.id, jti), eq(refreshTokens.userId, sub), isNull(refreshTokens.revokedAt)));
  } catch { /* Logout is idempotent and must not disclose token state. */ }
  res.status(204).send();
});
