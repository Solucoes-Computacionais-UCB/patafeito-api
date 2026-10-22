# Patafeito API

API REST do Patafeito, construída com Express, TypeScript, PostgreSQL e Drizzle ORM.

## Primeiros passos

1. Inicie o PostgreSQL local: `docker compose up -d`.
2. Opcionalmente, copie `.env.example` para `.env`. Sem esse arquivo, o ambiente de desenvolvimento usa o PostgreSQL Docker padrão (`postgres://postgres:postgres@localhost:5432/patafeito`) e segredos JWT locais.
3. Execute `npm install`.
4. Aplique as migrações: `npm run db:migrate`.
5. Inicie em desenvolvimento: `npm run dev`.

Para parar o banco, use `docker compose down`. Os dados permanecem no volume `patafeito_postgres_data`; para removê-los, use `docker compose down -v`.

> Se a máquina já tiver um PostgreSQL ouvindo na 5432, o container sobe mas quem atende as conexões é o servidor local — e a API falha com “autenticação do tipo senha falhou”. Nesse caso, defina `POSTGRES_PORT=5433` e `DATABASE_URL=postgres://postgres:postgres@localhost:5433/patafeito` no `.env`.

Com a API no ar, a documentação interativa (Swagger UI) fica em <http://localhost:3000/docs>, e `/` redireciona para lá. O contrato cru está em `/docs/openapi.json` e `/docs/openapi.yaml`. Em produção a rota fica desligada; use `DOCS_ENABLED=true` para publicá-la mesmo assim.

A API é exposta em `/api/v1`. Estão disponíveis healthcheck/readiness, cadastro/login/refresh/logout, pet inicial, tarefas, sessões Pomodoro de 25 minutos, loja e inventário. Tarefas rendem 2/4/8 moedas por dificuldade e cada Pomodoro integral rende 4 moedas.

`POST /api/v1/tasks/:id/reopen` desfaz uma conclusão: os lançamentos daquela tarefa saem do razão, o XP volta do pet e a tarefa fica pendente de novo — podendo ser concluída outra vez. Se as moedas já tiverem sido gastas, a operação é recusada com `COINS_ALREADY_SPENT`.

Notificações são persistidas na mesma transação das conclusões. O app as obtém em `GET /api/v1/notifications` e controla o estado de lida/não lida em `PATCH /api/v1/notifications/:id`; não há entrega push nem worker no backend.

O núcleo de sincronização offline está em `POST /api/v1/sync/push` e `GET /api/v1/sync/pull`. A API aceita criação, edição, exclusão, conclusão (`task.complete`) e reabertura de tarefas (`task.reopen`), conclusão de sessões de foco conduzidas no aparelho (`focus.complete`, com o id gerado pelo app e duração mínima de 25 minutos), alteração de leitura de notificações e equipamento de inventário; `pull` retorna `hasMore` para paginação. O `opId` é a chave de idempotência: reenviar a mesma operação devolve `duplicate` e nunca credita recompensa duas vezes. O cálculo de XP e moedas, as compras e o estado do pet continuam sob autoridade exclusiva do servidor; o saldo confirmado está em `GET /api/v1/rewards/balance`.

## Qualidade e testes

- `npm run lint`, `npm run typecheck` e `npm test` executam as verificações locais.
- `npm run test:integration` requer `TEST_DATABASE_URL` apontando para um PostgreSQL **exclusivo de testes**, já migrado. A suíte limpa suas tabelas.
- O contrato HTTP está em [`docs/openapi.yaml`](docs/openapi.yaml) e é servido pela própria API em `/docs`.

## Produção e operação

- A API aplica rate limiting, cabeçalhos de segurança, logs JSON por requisição e métricas Prometheus em `GET /metrics` quando `METRICS_TOKEN` está configurado.
- O pipeline em [`.github/workflows/ci.yml`](.github/workflows/ci.yml) valida lint, tipos, migrações e integração em PostgreSQL.
- Veja o processo de deploy, backup/restauração e a política de retenção do sync em [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

Refresh tokens são rotativos, persistidos com hash Argon2id e revogáveis por `POST /api/v1/auth/logout`.

> Em produção, defina `NODE_ENV=production`, `DATABASE_URL`, `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET`; a API recusa os valores locais padrão.
