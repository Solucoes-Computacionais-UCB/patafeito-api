import 'dotenv/config';
import { z } from 'zod';

const localDatabaseUrl = 'postgres://postgres:postgres@localhost:5432/patafeito';
const localAccessSecret = 'local-development-access-secret-change-in-production';
const localRefreshSecret = 'local-development-refresh-secret-change-in-production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url().default(localDatabaseUrl),
  JWT_ACCESS_SECRET: z.string().min(32).default(localAccessSecret),
  JWT_REFRESH_SECRET: z.string().min(32).default(localRefreshSecret),
  CORS_ORIGIN: z.string().url().default('http://localhost:8081'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  SYNC_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  METRICS_TOKEN: z.string().min(32).optional(),
  /** Swagger UI em `/docs`. Sem valor explícito, fica ligado fora de produção. */
  DOCS_ENABLED: z.enum(['true', 'false']).optional(),
  /** Quantos proxies reversos confiáveis ficam na frente da API (1 com nginx). Define `req.ip` para o rate limit. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production') {
    if (value.JWT_ACCESS_SECRET === localAccessSecret) context.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_ACCESS_SECRET'], message: 'JWT_ACCESS_SECRET deve ser configurado em produção.' });
    if (value.JWT_REFRESH_SECRET === localRefreshSecret) context.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_REFRESH_SECRET'], message: 'JWT_REFRESH_SECRET deve ser configurado em produção.' });
    if (value.DATABASE_URL === localDatabaseUrl) context.addIssue({ code: z.ZodIssueCode.custom, path: ['DATABASE_URL'], message: 'DATABASE_URL deve ser configurada em produção.' });
  }
});

export const env = schema.parse(process.env);

export const docsEnabled = env.DOCS_ENABLED ? env.DOCS_ENABLED === 'true' : env.NODE_ENV !== 'production';
