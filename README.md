# Patafeito API

API REST do Patafeito, construída com Express, TypeScript, PostgreSQL e Drizzle ORM.

## Primeiros passos

1. Copie `.env.example` para `.env` e informe as credenciais locais.
2. Execute `npm install`.
3. Gere/aplique as migrações: `npm run db:generate` e `npm run db:migrate`.
4. Inicie em desenvolvimento: `npm run dev`.

A API é exposta em `/api/v1`. Nesta fundação estão disponíveis healthcheck, cadastro/login/refresh e criação/consulta do pet inicial.
