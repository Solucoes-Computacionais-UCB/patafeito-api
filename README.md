# Patafeito API

API REST do Patafeito, construída com Express, TypeScript, PostgreSQL e Drizzle ORM.

## Primeiros passos

1. Inicie o PostgreSQL local: `docker compose up -d`.
2. Opcionalmente, copie `.env.example` para `.env`. Sem esse arquivo, o ambiente de desenvolvimento usa o PostgreSQL Docker padrão (`postgres://postgres:postgres@localhost:5432/patafeito`) e segredos JWT locais.
3. Execute `npm install`.
4. Aplique as migrações: `npm run db:migrate`.
5. Inicie em desenvolvimento: `npm run dev`.

Para parar o banco, use `docker compose down`. Os dados permanecem no volume `patafeito_postgres_data`; para removê-los, use `docker compose down -v`.

A API é exposta em `/api/v1`. Estão disponíveis healthcheck/readiness, cadastro/login/refresh/logout, pet inicial, tarefas, sessões Pomodoro de 25 minutos, loja e inventário. Tarefas rendem 2/4/8 moedas por dificuldade e cada Pomodoro integral rende 4 moedas.

Notificações são persistidas na mesma transação das conclusões. O app as obtém em `GET /api/v1/notifications` e controla o estado de lida/não lida em `PATCH /api/v1/notifications/:id`; não há entrega push nem worker no backend.

O núcleo de sincronização offline está em `POST /api/v1/sync/push` e `GET /api/v1/sync/pull`. A API aceita criação, edição e exclusão de tarefas, alteração de leitura de notificações e equipamento de inventário; `pull` retorna `hasMore` para paginação. XP, moedas, compras, foco e estado do pet continuam sob autoridade exclusiva do servidor.

## Qualidade e testes

- `npm run lint`, `npm run typecheck` e `npm test` executam as verificações locais.
- `npm run test:integration` requer `TEST_DATABASE_URL` apontando para um PostgreSQL **exclusivo de testes**, já migrado. A suíte limpa suas tabelas.
- O contrato HTTP está em [`docs/openapi.yaml`](docs/openapi.yaml).

Refresh tokens são rotativos, persistidos com hash Argon2id e revogáveis por `POST /api/v1/auth/logout`.

> Em produção, defina `NODE_ENV=production`, `DATABASE_URL`, `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET`; a API recusa os valores locais padrão.
