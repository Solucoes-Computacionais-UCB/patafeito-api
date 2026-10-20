import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { env } from '../../config/env.js';
import { recordHttpRequest } from '../observability/metrics.js';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function routeLabel(req: Request) {
  return `${req.baseUrl}${req.route?.path ?? req.path}`.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id');
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function requestTelemetry(req: Request, res: Response, next: NextFunction) {
  const startedAt = performance.now();
  res.on('finish', () => {
    const durationMs = Math.round(performance.now() - startedAt);
    const route = routeLabel(req);
    recordHttpRequest(route, res.statusCode, durationMs);
    console.log(JSON.stringify({ level: 'info', event: 'http_request', requestId: res.locals.requestId, method: req.method, route, status: res.statusCode, durationMs }));
  });
  next();
}

export function rateLimit(name: string, maxRequests: number, windowMs: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${name}:${req.ip}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) return next(new AppError(429, 'RATE_LIMITED', 'Muitas requisições. Tente novamente em instantes.'));
    return next();
  };
}
