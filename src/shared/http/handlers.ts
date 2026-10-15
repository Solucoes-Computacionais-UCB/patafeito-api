import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.js';

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', `Rota não encontrada: ${req.method} ${req.path}`));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.header('x-request-id') ?? crypto.randomUUID();
  if (error instanceof ZodError) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details: error.flatten(), requestId } });
  const appError = error instanceof AppError ? error : new AppError(500, 'INTERNAL_ERROR', 'Erro interno do servidor.');
  if (appError.status >= 500) console.error({ requestId, error });
  return res.status(appError.status).json({ error: { code: appError.code, message: appError.message, details: appError.details, requestId } });
}
