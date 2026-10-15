import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';

export interface AuthenticatedRequest extends Request { userId?: string }

export function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'Token de acesso ausente.'));
  try {
    req.userId = (jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string }).sub;
    next();
  } catch { next(new AppError(401, 'UNAUTHENTICATED', 'Token de acesso inválido ou expirado.')); }
}
