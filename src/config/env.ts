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
}).superRefine((value, context) => {
  if (value.NODE_ENV !== 'production') return;
  if (value.JWT_ACCESS_SECRET === localAccessSecret) context.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_ACCESS_SECRET'], message: 'JWT_ACCESS_SECRET deve ser configurado em produção.' });
  if (value.JWT_REFRESH_SECRET === localRefreshSecret) context.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_REFRESH_SECRET'], message: 'JWT_REFRESH_SECRET deve ser configurado em produção.' });
  if (value.DATABASE_URL === localDatabaseUrl) context.addIssue({ code: z.ZodIssueCode.custom, path: ['DATABASE_URL'], message: 'DATABASE_URL deve ser configurada em produção.' });
});

export const env = schema.parse(process.env);
