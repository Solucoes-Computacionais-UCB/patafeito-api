# Deploy na VPS (Docker + nginx)

Arquitetura: nginx no host (TLS via certbot) → `127.0.0.1:3000` → container da API → container PostgreSQL (sem porta publicada).

## 1. Preparar a VPS (Ubuntu/Debian, uma vez)

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # saia e entre de novo no SSH
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

Aponte um registro DNS `A` (ex.: `api.seudominio.com.br`) para o IP da VPS.

## 2. Código e segredos

```bash
git clone <url-do-repo> ~/patafeito-api && cd ~/patafeito-api
cp .env.example .env
chmod 600 .env
openssl rand -hex 32   # rode 3 vezes: senha do banco e os dois segredos JWT
nano .env              # use o bloco "Produção" do final; a senha precisa ser a mesma em POSTGRES_PASSWORD e DATABASE_URL
```

## 3. Subir

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs migrate   # deve mostrar "Migrações aplicadas."
curl http://127.0.0.1:3000/ready
```

## 4. nginx + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/patafeito-api
sudo sed -i 's/api.seudominio.com.br/SEU_DOMINIO/' /etc/nginx/sites-available/patafeito-api
sudo ln -s /etc/nginx/sites-available/patafeito-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d SEU_DOMINIO
curl https://SEU_DOMINIO/ready
```

No app, defina a URL da API como `https://SEU_DOMINIO`.

## Deploy automático (GitHub Actions)

`.github/workflows/ci.yml` roda lint, typecheck, build e testes (com Postgres) em todo push e PR. Num push na `main` com tudo verde, entra na VPS por SSH, faz `git reset --hard` para o commit testado e roda `deploy/deploy.sh`. O script faz backup em `~/backups` (guarda os 14 últimos), rebuilda, migra e espera `/ready`.

Configuração, uma vez:

1. **Chave de deploy da VPS para ler o repo** (o repo é privado). Na VPS:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ''
   cat ~/.ssh/github_deploy.pub   # GitHub → repo → Settings → Deploy keys → Add (só leitura)
   printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n' >> ~/.ssh/config
   git -C ~/patafeito-api remote set-url origin git@github.com:patafeito/patafeito-api.git
   git -C ~/patafeito-api fetch   # confirma o acesso
   ```
2. **Chave para o GitHub Actions entrar na VPS.** Na sua máquina:
   ```bash
   ssh-keygen -t ed25519 -f gha_deploy -N '' -C github-actions
   ssh-copy-id -i gha_deploy.pub USUARIO@IP_DA_VPS
   ssh-keyscan -p 22 IP_DA_VPS   # saída vai em VPS_KNOWN_HOSTS
   ```
3. **GitHub → repo → Settings → Environments → New environment `production`** e, nele, os secrets:

   | Secret | Valor |
   | --- | --- |
   | `VPS_HOST` | IP ou domínio da VPS |
   | `VPS_USER` | usuário SSH (precisa estar no grupo `docker`) |
   | `VPS_SSH_KEY` | conteúdo do arquivo `gha_deploy` (chave privada) |
   | `VPS_KNOWN_HOSTS` | saída do `ssh-keyscan` |
   | `VPS_PORT` | opcional, padrão 22 |

   Variável opcional `APP_DIR` (padrão `~/patafeito-api`). No environment dá para exigir aprovação manual antes de cada deploy (*Required reviewers*). Apague `gha_deploy` da sua máquina depois de cadastrar.

Para refazer um deploy sem novo commit: Actions → *CI / Deploy* → *Run workflow*.

## Atualizar manualmente

```bash
git pull && bash deploy/deploy.sh
```

## Backup

`.env` contém `POSTGRES_USER`/`POSTGRES_DB`; os comandos rodam dentro do container:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > patafeito-$(date +%F).dump
```

Copie o arquivo para fora da VPS. Restauração e política de retenção: ver `docs/OPERATIONS.md`.
