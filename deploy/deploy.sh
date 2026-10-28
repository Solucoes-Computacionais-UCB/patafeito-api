#!/usr/bin/env bash
# Roda na VPS, dentro do diretório do repositório. Chamado pelo GitHub Actions após `git reset`.
set -euo pipefail

compose() { docker compose -f docker-compose.prod.yml "$@"; }

# Backup antes de migrar, se o banco já estiver no ar. Mantém os 14 mais recentes.
if [ -n "$(compose ps -q postgres 2>/dev/null)" ]; then
  mkdir -p "$HOME/backups"
  compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' \
    > "$HOME/backups/patafeito-$(date +%F-%H%M%S).dump"
  ls -1t "$HOME"/backups/patafeito-*.dump | tail -n +15 | xargs -r rm --
fi

compose up -d --build --remove-orphans

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_HOST_PORT:-3000}/ready" > /dev/null; then
    echo 'API pronta.'
    docker image prune -f > /dev/null
    exit 0
  fi
  sleep 2
done

echo 'API não ficou pronta em 60s.' >&2
compose logs --tail=50 migrate api >&2
exit 1
