# Patafeito — Arquitetura do Backend

Documento técnico de arquitetura • versão 1.2 • 27/10/2026

Status: arquitetura-alvo com o núcleo do MVP implementado (fases 1, 2, 3 e 5 concluídas no escopo de código; 0 e 4 parciais — ver seção 10). Os blocos “Situação em 27/10/2026” indicam onde a implementação difere do texto. Base: Roteiro do Projeto de Desenvolvimento de Solução Computacional (43 páginas).

Convenção: \[BASE\] = previsto no roteiro; \[PROPOSTA\] = detalhamento técnico recomendado; \[DECIDIR\] = item em aberto.

## Resumo executivo

\[BASE\] Serviço Node.js/Express, API REST, banco PostgreSQL remoto, regras de gamificação, sincronização e FCM. \[PROPOSTA\] Um monólito modular TypeScript, Drizzle ORM para acesso ao PostgreSQL, camadas por módulo, transações de domínio e contratos versionados; reduz custo e complexidade no MVP.

## 1. Objetivos, escopo e princípios

- Garantir que tarefas, XP, moedas e estado do pet permaneçam consistentes, mesmo com pedidos repetidos ou dispositivos offline.

- Centralizar as decisões econômicas e de progressão; não aceitar XP ou saldos calculados pelo cliente como verdade.

- Isolar autenticação, tarefas, gamificação, foco, catálogo/inventário, social, relatórios, notificações e sincronização.

- Priorizar rastreabilidade, segurança, testes e implantação simples em vez de microsserviços prematuros.

## 2. Arquitetura lógica

> APP React Native + SQLite
>
> \| HTTPS JSON /api/v1 + token
>
> v
>
> Express API -\> Auth -\> Controllers -\> Application Services
>
> \| Domain rules / transactions
>
> v
>
> Repositories -\> Drizzle ORM -\> PostgreSQL
>
> \|
>
> Outbox / Worker -\> FCM

\[PROPOSTA\] Controller valida entrada e converte HTTP; Application Service executa casos de uso/transações; Domain concentra regras puras; Repository encapsula consultas e comandos implementados com Drizzle ORM (sem vazar tipos de banco para o domínio). Worker assíncrono envia mensagens e executa rotinas recorrentes; processo separado opcional.

### 2.1 Organização de diretórios

> src/
>
> app.ts server.ts config/ shared/{errors,auth,db,events,validation}
>
> modules/
>
> identity/{http,application,domain,infrastructure}
>
> tasks/{http,application,domain,infrastructure}
>
> pets/{http,application,domain,infrastructure}
>
> focus/{http,application,domain,infrastructure}
>
> rewards/{http,application,domain,infrastructure}
>
> inventory/{http,application,domain,infrastructure}
>
> social/{http,application,domain,infrastructure}
>
> notifications/{http,application,domain,infrastructure}
>
> sync/{http,application,domain,infrastructure}
>
> jobs/ db/{client,schema,relations}/ drizzle/ drizzle.config.ts tests/{unit,integration,contract,e2e}/

**Situação em 27/10/2026:** `shared/` tem `auth`, `errors`, `http` e `observability`. Os módulos usam as camadas conforme a necessidade (`http` sempre; `application`/`domain`/`infrastructure` quando há regra ou acesso compartilhado); as consultas ficam nas rotas e nos serviços, sem repositórios dedicados. Existe também o módulo `shop/`; `social/` e `jobs/` estão vazios. Em `tests/` só há `unit` e `integration`.

### 2.2 Dependências recomendadas

| Área            | Escolha / critério                                                          |
|-----------------|-----------------------------------------------------------------------------|
| Runtime         | Node.js LTS + TypeScript (versão a fixar no repositório)                    |
| HTTP            | Express + middleware de erro, log e rate limiting                           |
| Validação       | Zod ou similar, schemas partilháveis quando fizer sentido                   |
| Persistência    | PostgreSQL + **Drizzle ORM** + **Drizzle Kit** para schema e migrações      |
| Autenticação    | Senhas com Argon2id, access token de curta duração e refresh token rotativo |
| Testes          | Vitest/Jest + Supertest + PostgreSQL de teste                               |
| Observabilidade | Logs estruturados, request-id, métricas e health/readiness                  |
| Push            | Firebase Admin / FCM com credenciais só no servidor                         |

## 3. Módulos e responsabilidades

| Módulo        | Responsabilidades e limites                                                    |
|---------------|--------------------------------------------------------------------------------|
| Identity      | Registro, login, refresh, encerramento, exclusão de conta e dispositivos       |
| Tasks         | CRUD, prazo, dificuldade, tipos, instâncias de recorrência, status e histórico |
| Pets          | Criação, escolha de espécie, nome, atributos, reações e evolução               |
| Focus         | Sessões iniciadas/concluídas, tempo esperado, bloqueio de duplicidade          |
| Rewards       | Concessão de XP/moedas, ledger, streak, metas e penalidades                    |
| Inventory     | Catálogo, compra transacional, item possuído, equipamento                      |
| Social        | Solicitações/amizades e ranking com visibilidade controlada                    |
| Notifications | Preferências, lembretes, push e registro de envios                             |
| Sync          | Recepção de operações offline, cursor de mudança e reconciliação               |

## 4. Modelo de dados

\[BASE\] O roteiro lista USUARIO, PET, ESPECIE_PET, TAREFA, USUARIO_TAREFA, RECORRENCIA_TAREFA, SESSAO_POMODORO, REGISTRO_PRODUTIVIDADE, METAS, USUARIO_META, NOTIFICACAO, USUARIO_NOTIFICACAO, AMIZADE, ITEM_COSMETICO, CATEGORIA e INVENTARIO (páginas 31–32).

\[PROPOSTA\] Complementar com ledger de recompensas, operações idempotentes e dispositivos para sincronização/confiabilidade. Evitar colunas derivadas sem política explícita de atualização.

| Entidade         | Campos essenciais / observações                                                                               |
|------------------|---------------------------------------------------------------------------------------------------------------|
| users            | id UUID, email UNIQUE, password_hash, display_name, created_at, deleted_at                                    |
| pets             | id, user_id UNIQUE, species_id, name, level, xp_total, health, hunger, happiness, version                     |
| tasks            | id UUID, user_id, title, description, difficulty, kind, due_at, status, version                               |
| task_occurrences | id, task_id, scheduled_for, completed_at, UNIQUE(task_id,scheduled_for)                                       |
| recurrence_rules | task_id, frequency, interval, timezone, next_run_at                                                           |
| focus_sessions   | id, user_id, task_id NULL, mode, started_at, duration_sec, finished_at, status                                |
| reward_ledger    | id, user_id, source_type, source_id, xp_delta, coin_delta, occurred_at, UNIQUE(source_type,source_id,user_id) |
| inventory_items  | id, user_id, cosmetic_id, acquired_at, equipped_at                                                            |
| device_tokens    | id, user_id, platform, fcm_token, last_seen_at                                                                |
| sync_operations  | op_id UUID UNIQUE, user_id, device_id, result, applied_at                                                     |
| outbox_events    | id, topic, payload, status, attempts, next_attempt_at                                                         |

**Situação em 27/10/2026:** a recorrência foi implementada com colunas em `tasks` (`recurrence`, `recurrence_day`, `series_id`; cada repetição é uma tarefa própria), no lugar de `task_occurrences`/`recurrence_rules`. O pet usa `energy` em vez de `health`. Também existem `shop_items`, `inventory`, `active_boosts`, `pet_companions`, `notifications`, `idempotency_operations` e `sync_changes`. Ainda não existem `device_tokens` e `outbox_events` (sem push/worker), nem restrições `CHECK` no banco: status, dificuldade e a faixa 0–100 são validados só na aplicação.

### 4.1 Integridade e índices

- FKs em toda relação; índices compostos tasks(user_id,status,due_at), focus_sessions(user_id,started_at), reward_ledger(user_id,occurred_at).

- Restrições CHECK para status, dificuldade e atributos 0–100; timestamps UTC e timezone IANA por usuário.

- Cada transação de conclusão de tarefa atualiza status, ledger e pet atomicamente; compra debita moedas e concede item na mesma transação. **Usar `db.transaction(...)` no Drizzle, propagando o `tx` para os repositórios participantes**; capturar violação de UNIQUE para garantir idempotência e considerar concorrência/locks no PostgreSQL.

- Usar **migrações SQL versionadas geradas com Drizzle Kit**, revisadas no Git e aplicadas em etapa controlada de deploy; seeds somente de catálogo/espécies e backup/restauração testados.

## 4.2 ORM e migrações: Drizzle (decisão técnica)

**[DECISÃO]** Usar **Drizzle ORM** como camada de acesso a dados PostgreSQL, com **Drizzle Kit** para gerar e aplicar migrações. O Drizzle substitui a opção genérica “ORM ou query builder” da versão anterior; o banco continua sendo PostgreSQL. Não colocar lógica de negócio em hooks ou no schema: as regras de XP, moedas, pet e tarefas permanecem nos serviços/domínio.

**Pacotes recomendados** (driver Node.js `pg`):

```bash
npm install drizzle-orm pg
npm install -D drizzle-kit @types/pg
```

**Organização sugerida:**

```text
src/
  db/
    client.ts              # pool pg e instância do Drizzle
    schema/
      users.ts
      pets.ts
      tasks.ts
      reward-ledger.ts
      index.ts
    relations/             # relações opcionais por entidade
  modules/
    tasks/infrastructure/task.repository.ts
    rewards/infrastructure/reward.repository.ts
    pets/infrastructure/pet.repository.ts
drizzle/                   # SQL e metadados de migrações versionados
  ...
drizzle.config.ts
```

**Configuração mínima de referência** (ajustar imports e nomes ao repositório):

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

```ts
// src/db/client.ts
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });
```

```ts
// src/db/schema/tasks.ts (exemplo parcial)
import { pgTable, uuid, varchar, timestamp, integer, index } from 'drizzle-orm/pg-core';

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(), // adicionar FK para users
  title: varchar('title', { length: 200 }).notNull(),
  difficulty: varchar('difficulty', { length: 12 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  version: integer('version').notNull().default(1),
  dueAt: timestamp('due_at', { withTimezone: true }),
}, (table) => [
  index('tasks_user_status_due_idx').on(table.userId, table.status, table.dueAt),
]);
```

O exemplo é intencionalmente parcial: completar FKs, CHECKs/enums, timestamps de auditoria, demais campos e entidades conforme a seção 4 antes de gerar a primeira migração. IDs, `UNIQUE`, chaves estrangeiras e restrições críticas devem ser garantidos também pelo PostgreSQL, não apenas por validação em TypeScript/Zod.

**Comandos e fluxo de migração:**

```bash
npx drizzle-kit generate     # gera SQL versionado a partir do schema
npx drizzle-kit migrate      # executa migrações pendentes no banco configurado
```

- Versionar o diretório `drizzle/` e revisar as alterações SQL em pull requests.
- Gerar migrações em desenvolvimento; **não executar `push` diretamente em produção** como estratégia principal de deploy.
- Usar bancos isolados para desenvolvimento, testes e produção; guardar `DATABASE_URL` em variáveis de ambiente e validar sua existência na inicialização.
- Executar migração como etapa única e controlada antes de subir a nova versão da API; planejar migrações compatíveis com deploy gradual e backups.
- Para testes de integração, usar PostgreSQL real isolado, aplicar migrações e limpar dados entre testes.

**Padrão transacional e idempotência:**

```ts
await db.transaction(async (tx) => {
  // Os repositórios recebem tx, não a conexão global.
  // 1. Confirmar usuário, tarefa, status e prazo sob proteção concorrente.
  // 2. Registrar conclusão com condição de status/versão apropriada.
  // 3. Inserir reward_ledger com UNIQUE de origem para evitar XP duplicado.
  // 4. Atualizar pet e criar evento outbox na mesma transação.
});
```

A transação, por si só, não elimina corridas: fazer atualização condicional, aplicar as garantias `UNIQUE` e, nos fluxos necessários, usar bloqueio de linha compatível com PostgreSQL. Em conflitos de idempotência, recuperar a operação já registrada e retornar seu resultado anterior.

## 5. Regras de negócio a implementar

| Regra     | Definição do roteiro                                          | Observação de implementação                      |
|-----------|---------------------------------------------------------------|--------------------------------------------------|
| RN01      | Fácil 10 XP; média 20 XP; difícil 40 XP                       | Ledger idempotente por conclusão                 |
| RN02      | Três tarefas vencidas consecutivas afetam humor               | Definir semântica de consecutividade \[DECIDIR\] |
| RN03      | Pet evolui por escala incremental                             | Tabela de thresholds versionada \[DECIDIR\]      |
| RN04      | Só sessão Pomodoro integral concede XP                        | Implementada no MVP: 25 minutos integrais, 20 XP e conclusão idempotente |
| RN05      | 25 min foco/5 min pausa; pausa longa após 4 ciclos            | Definir duração longa \[DECIDIR\]                |
| RN06      | Tarefa recorrente gera próxima ocorrência sem dupla conclusão | UNIQUE para instância e operação                 |
| RN07      | Bônus por sequência produtiva                                 | Tabela de critérios e bônus \[DECIDIR\]          |
| RN08      | Tarefa vencida só pode excluir/replanejar                     | Atenção à UX e auditoria                         |
| RN09      | Nome pet 2–15 caracteres                                      | Validação por grapheme/Unicode                   |
| RN11/RN13 | Inatividade \>24h e meta diária mínima                        | Definir fuso, janela e valores \[DECIDIR\]       |
| RN12      | Cosméticos exigem desbloqueio/compra                          | Controle centralizado no servidor                |
| RN14      | Até 5 tarefas especiais por semana; sem XP direto             | Restringir por usuário + semana local            |

**Situação em 27/10/2026:** implementadas RN01, RN03 (thresholds 100/300/600…), RN04, RN05 (pausa longa configurável no app), RN06 (série com id determinístico por data), RN08 (inclusive reagendamento offline via `task.update` só de prazo) e RN12. RN09 valida 2–15 caracteres por unidade de código, não por grapheme. **Não implementadas:** RN02, RN07 (o escudo protege a sequência, mas não há bônus), RN11/RN13 e RN14 (não há tarefa especial).

## 6. Contrato HTTP da API v1

\[PROPOSTA\] Rotas planejadas; o que já existe está no bloco de situação abaixo e em `docs/openapi.yaml`. Respostas padronizadas {data} (`meta` ainda não é usado) e erros {error:{code,message,details,requestId}}. Autorização por usuário, paginação cursor-based para históricos.

| Método           | Rota                                       | Objetivo                 |
|------------------|--------------------------------------------|--------------------------|
| POST             | /auth/register, /auth/login, /auth/refresh | Autenticar               |
| GET/PATCH        | /me                                        | Perfil                   |
| DELETE           | /me                                        | Solicitar exclusão       |
| GET/POST         | /tasks                                     | Listar/criar             |
| GET/PATCH/DELETE | /tasks/:id                                 | Consultar/editar/excluir |
| POST             | /tasks/:id/complete                        | Concluir e premiar       |
| POST             | /tasks/:id/reschedule                      | Reagendar vencida        |
| GET              | /pets/me                                   | Estado e espécie         |
| POST             | /pets/me/interactions                      | Alimentar/brincar/curar  |
| POST             | /focus-sessions                            | Registrar início         |
| POST             | /focus-sessions/:id/finish                 | Concluir foco            |
| GET              | /rewards/ledger                            | Extrato de moedas e XP   |
| GET/POST         | /shop/items, /shop/purchases               | Catálogo/comprar         |
| GET/PATCH        | /inventory                                 | Listar/equipar           |
| GET              | /stats/overview                            | Indicadores              |
| GET/POST         | /friends                                   | Relações sociais         |
| POST             | /devices                                   | Registrar push token     |
| POST             | /sync/push                                 | Enviar mutações offline  |
| GET              | /sync/pull?cursor=                         | Receber mudanças         |

**Situação em 27/10/2026:** o contrato vigente é o de `docs/openapi.yaml`. Da tabela acima, ainda **não existem** `POST /pets/me/interactions` (alimentar existe via `POST /inventory/use` e `pet.feed` no sync), `GET /rewards/ledger` (há `GET /rewards/balance`), `GET /stats/overview`, `GET/POST /friends` e `POST /devices`. `DELETE /me` exclui a conta de forma definitiva, sem período de carência. Rotas extras já implementadas: `/auth/logout`, `/me/password`, `/me/reset-progress`, `/pets/me/switch`, `/pets/me/history`, `/tasks/:id/reopen`, `/inventory/use`, `/inventory/boosts` e `/notifications`.

### 6.1 Exemplo de conclusão idempotente

> POST /api/v1/tasks/{taskId}/complete
>
> Authorization: Bearer \<access_token\>
>
> Idempotency-Key: 7d4a... (UUID da operação)
>
> { "completedAt": "2026-10-12T17:00:00Z" }
>
> 200 OK
>
> { "data": { "taskId": "...", "status": "completed",
>
> "rewards": { "xp": 20, "coins": 0 },
>
> "pet": { "level": 3, "xpTotal": 140, "version": 12 } } }

Fluxo: autenticar → validar posse e estado → verificar idempotência e prazo → bloquear linha → marcar conclusão → inserir ledger → atualizar pet → registrar evento outbox → commit → responder. Repetição retorna o mesmo resultado.

## 7. Offline-first e sincronização

\[BASE\] Operações principais offline e sincronização após reconexão aparecem no roteiro, embora outro item marque “sincronização em nuvem” como fora de escopo. \[DECIDIR\] Validar se o MVP deve entregar sync completo ou somente persistência offline; aqui está uma proposta de implementação.

- Cada mutação local tem opId UUID, entidade, versão-base, instante e payload; cliente registra em fila persistente.

- POST /sync/push aceita lote limitado e retorna resultado por operação: applied / duplicate / conflict / rejected.

- GET /sync/pull recebe cursor opaco por usuário e envia entidades alteradas/tombstones; garantir tenant isolation.

- Servidor é autoridade para XP, dinheiro e estados; não receber saldos do cliente. Offline mostra recompensas provisórias até confirmação.

- Conflito: tarefas com edição concorrente exigem versionamento e UI de resolução; conclusão é idempotente; exclusão usa tombstone.

- Sincronização com retry exponencial, backoff, tratamento 401 e avanço de cursor apenas após gravação local íntegra.

## 8. Segurança, privacidade e operação

- HTTPS obrigatório; segredo fora do Git; hashes Argon2id; refresh tokens armazenados com hash, revogáveis e com rotação.

- Autorização por recurso e user_id; rate limiting por IP/conta; validação de payload e limites; CORS apenas onde aplicável.

- Dados mínimos; política de retenção e exclusão conforme LGPD; não registrar senhas/tokens nos logs.

- Jobs de prazos/inatividade com execução idempotente; notificações através da outbox; retries, métricas de falha e token FCM inválido removido.

- Ambientes dev/test/prod; CI executa lint, typecheck, testes, migrations verificadas e scan de dependências.

- Métricas: latência p95, taxa de erro 5xx, falhas de sincronização, backlog de outbox, notificações e conexão ao banco.

## 9. Estratégia de testes e critérios de aceite

| Camada      | Cenários obrigatórios                                                               |
|-------------|-------------------------------------------------------------------------------------|
| Unidade     | XP por dificuldade, níveis, datas, recorrência, streak, penalidades, validação nome |
| Integração  | Concluir tarefa transacional, comprar item, múltiplas requisições concorrentes, FKs |
| Contrato    | Schemas de request/response, erros e paginação para o app                           |
| E2E         | Cadastro → pet → tarefa → foco → recompensa → loja → logout/login                   |
| Resiliência | Reenvio de operação, rede oscilante, token expirado, migração, worker duplicado     |
| Segurança   | IDOR (acesso a tarefa de outro usuário), brute force, injection, limite de payload  |

**Situação em 27/10/2026:** há testes unitários (XP, moedas, níveis, status do pet, recorrência, foco) e de integração com PostgreSQL real (conta, tarefas, sync, foco, loja, pet), executados na CI. Faltam testes de contrato, E2E, resiliência e segurança, e a cobertura ainda não é medida.

Meta de cobertura de domínio/serviços de pelo menos 80% está no RNF011. Aceite não é só cobertura: fluxos críticos precisam de testes verdes com banco real de teste.

## 10. Implantação e plano de entrega

- Fase 0 — definir regras incompletas e políticas de offline/iOS; alinhar contrato e entidades. **Parcial:** regras econômicas e sync ainda aguardam decisão.

- Fase 1 — fundação: repositório, CI, PostgreSQL, **Drizzle ORM/Kit, schema e migrações versionadas**, auth, healthchecks, OpenAPI. **Concluída:** CI (`.github/workflows/ci.yml`) executa lint, typecheck, migrações, `drizzle-kit check`, testes contra PostgreSQL e `npm audit`; há `/health`, `/ready`, `docs/openapi.yaml` e refresh token rotativo/revogável.

- Fase 2 — tarefas, pet, regras XP, ledger, transações e testes. **Concluída para o escopo definido:** CRUD de tarefas, RN01, ledger, transação de conclusão, idempotência persistida, progressão de nível e testes unitários/integração.

- Fase 3 — sessões de foco, loja, inventário, notificações. **Concluída para o escopo de MVP:** sessões de foco de 5 a 120 minutos (padrão 25) têm recompensa idempotente de 20 XP e 4 moedas a cada 25 minutos; tarefas rendem 1/2/3 moedas por dificuldade; catálogo cosmético, compra transacional e inventário/equipamento estão implementados; notificações de conclusão são persistidas e o app controla seu estado de lida/não lida. Não há push nem worker no backend.

- Fase 4 — sincronização offline e recuperação; ranking/social apenas após fluxo central estável. **Parcial:** `sync/push` e `sync/pull` oferecem snapshot inicial, cursor por usuário, idempotência de operação, conflitos por versão e tombstones para tarefas; notificações também sincronizam o estado de leitura. Uma tarefa vencida aceita `task.update` apenas para reagendar. No app, a fila SQLite e o retry/backoff estão implementados; a UI de resolução de conflitos, não.

- Fase 5 — observabilidade, segurança, backup, carga e demonstração do MVP. **Concluída no escopo de código:** logs JSON com `requestId`, métricas Prometheus protegidas, rate limiting, cabeçalhos de segurança, CI com PostgreSQL real e runbook de deploy/backup/restauração. Hospedagem, credenciais, execução do backup e teste de carga exigem a infraestrutura de produção.

## 11. Pendências para decisão da equipe

- Como separar XP total, XP do pet e moedas gastáveis? O documento mistura custo em XP e moedas virtuais.

  - Implementação atual: `xp_total` é o XP acumulado do pet; moedas são apuradas pelo `reward_ledger`. Tarefas rendem 1/2/3 e cada ciclo de 25 minutos de foco rende 4 moedas (ciclos de 5 a 120 minutos rendem proporcionalmente); compras inserem débitos no ledger. O nível usa thresholds incrementais: nível 2 com 100 XP, nível 3 com 300 XP, nível 4 com 600 XP.

- Quais valores exatos de bônus de streak, penalidades, recuperação e thresholds de nível? O MVP fixa a sessão Pomodoro integral em 25 minutos e 20 XP, sujeito à revisão de produto.

- Sync em nuvem faz parte do MVP? Roteiro apresenta instruções conflitantes.

- Onde hospedar API e PostgreSQL? Qual orçamento, SLA e política de backup?

- Ranking público/privado e exclusão de dados de amizades: definir consentimento e visibilidade.

## 12. Rastreabilidade

Fonte principal: roteiro fornecido pela equipe, em especial pp. 2–10 (requisitos e regras), pp. 25–30 (arquitetura, componentes, tecnologias e infraestrutura), pp. 31–35 (dados) e pp. 11–24 (interfaces). Este documento descreve a arquitetura-alvo; o que já está implementado aparece na seção 10 e nos blocos “Situação”. O contrato vigente é `docs/openapi.yaml`.
