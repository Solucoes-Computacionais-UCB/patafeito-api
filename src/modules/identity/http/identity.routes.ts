import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { users } from '../../../db/schema/users.js';
import { AppError } from '../../../shared/errors/app-error.js';

export const identityRouter = Router();
const credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(128) });
const registerInput = credentials.extend({ displayName: z.string().trim().min(2).max(80) });
const issueTokens = (id: string) => ({ accessToken: jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: id, expiresIn: '15m' }), refreshToken: jwt.sign({}, env.JWT_REFRESH_SECRET, { subject: id, expiresIn: '30d' }) });

identityRouter.post('/register', async (req, res) => {
  const input = registerInput.parse(req.body);
  const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (existing) throw new AppError(409, 'EMAIL_IN_USE', 'Este e-mail já está em uso.');
  const [user] = await db.insert(users).values({ email: input.email, displayName: input.displayName, passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }) }).returning({ id: users.id, email: users.email, displayName: users.displayName });
  res.status(201).json({ data: { user, tokens: issueTokens(user.id) } });
});

identityRouter.post('/login', async (req, res) => {
  const input = credentials.parse(req.body);
  const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (!user || !(await argon2.verify(user.passwordHash, input.password))) throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
  res.json({ data: { user: { id: user.id, email: user.email, displayName: user.displayName }, tokens: issueTokens(user.id) } });
});

identityRouter.post('/refresh', (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
  try { const { sub } = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string }; res.json({ data: { tokens: issueTokens(sub) } }); }
  catch { throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token inválido ou expirado.'); }
});
