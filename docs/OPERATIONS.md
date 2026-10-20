# Operação da API

## Deploy seguro

1. Defina `NODE_ENV=production`, `DATABASE_URL`, segredos JWT, `CORS_ORIGIN` e, opcionalmente, `METRICS_TOKEN` no provedor de segredos.
2. Crie um backup verificado antes de cada deploy.
3. Execute `npm ci`, `npm run build` e `npm run db:migrate` **uma única vez** contra o banco de produção.
4. Suba a versão com `npm start` e confirme `GET /ready`.
5. Monitore erros 5xx, latência e o crescimento de `sync_changes` em `GET /metrics` usando o cabeçalho `x-metrics-token`.

## Backup e restauração PostgreSQL

Execute o backup a partir de uma máquina confiável, com SSL e credenciais fora do shell history:

```bash
pg_dump --format=custom --no-owner --file=patafeito-$(date +%F).dump "$DATABASE_URL"
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" patafeito-AAAA-MM-DD.dump
```

Teste periodicamente a restauração em um banco isolado. Defina retenção, criptografia e local externo ao banco de produção conforme a política da equipe.

## Sincronização

`sync_changes` é um log necessário para clientes offline. Não execute limpeza automática sem rastrear o cursor de cada dispositivo: apagar mudanças antes de todos os clientes avançarem pode causar perda de sincronização. Enquanto essa política não existir, monitore o crescimento da tabela e faça compactação planejada com uma nova sincronização completa dos clientes.
