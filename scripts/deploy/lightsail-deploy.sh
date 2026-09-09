#!/usr/bin/env bash
# Build + release the app on an AWS Lightsail "Amazon Linux 2023" instance.
# Run from the repo root after lightsail-bootstrap.sh and after .env.production
# is filled in.
#
#   bash scripts/deploy/lightsail-deploy.sh
#
# Re-runnable: pulls latest, installs deps, brings up Postgres, rebuilds,
# reloads PM2. Schema sync is NOT done here — see the "Schema" note below.
# Caddy is supervised separately by systemd and is NOT touched here (config
# changes: edit /etc/caddy and `sudo systemctl reload caddy`).
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ ! -f .env.production ]; then
  echo "ERROR: .env.production missing. cp .env.production.example .env.production and fill it." >&2
  exit 1
fi

# ── Runtime env: `.env.production` 파일이 단일 출처 ─────────────────────────
# 여기서 .env.production 을 셸 전역에 export 하지 않는다. PM2 는 프로세스를 띄운
# 시점의 셸 env 를 스냅샷해 restart/reload 에서 재사용하고(`pm2 save` 로 dump 에도
# 영속), 프로세스 env 는 `next start` 가 부팅 때 읽는 .env.production 파일보다
# 우선한다. 과거에 전역 export + `--update-env` 조합이 구 도메인 AUTH_URL 을 PM2 에
# 박제해, 파일을 고쳐도 반영되지 않는 장애를 만들었다. env 가 필요한 단계(빌드의
# NEXT_PUBLIC_* 인라인 등)만 서브셸로 국한한다.

# 레포는 private 이라 pull 이 read-only deploy key 로 인증한다(docs/DEPLOY_LIGHTSAIL.md
# §서버 프로비저닝 2단계). 인증이 깨졌을 때 git 이 자격증명 프롬프트를 띄우면 배포가
# 무한 대기에 빠진다 — 원인 파악이 실패보다 훨씬 느리므로 즉시 non-zero 로 죽인다.
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="ssh -o BatchMode=yes"

log "Pulling latest"
git pull --ff-only

log "Installing dependencies (frozen lockfile, pnpm 9)"
pnpm install --frozen-lockfile

log "Ensuring Postgres container is up"
# --env-file: compose 인터폴레이션(${POSTGRES_PASSWORD:?} 등)에 필요한 값을 셸에
# export 하지 않고 컨테이너 정의에만 공급한다.
docker compose --env-file ./.env.production -f docker-compose.prod.yml up -d
# Wait for Postgres to accept connections before the app starts.
PG_USER="$( ( set -a; . ./.env.production; set +a; echo "${POSTGRES_USER:-supporter_b}" ) )"
for i in $(seq 1 30); do
  if docker compose --env-file ./.env.production -f docker-compose.prod.yml exec -T pg \
       pg_isready -U "$PG_USER" >/dev/null 2>&1; then
    break
  fi
  [ "$i" = "30" ] && { echo "Postgres did not become ready in time" >&2; exit 1; }
  sleep 1
done

# ── Schema ───────────────────────────────────────────────────────────────
# No automatic migration here. We run push-only for now, and a non-interactive
# `drizzle-kit push --force` would apply destructive diffs (DROP / type changes)
# to prod WITHOUT review. So when the schema changed, sync it MANUALLY *before*
# deploying and review the plan:
#
#     set -a; . ./.env.production; set +a
#     pnpm db:push        # review: additive → Yes; DROP / data-loss → abort
#
# Skipping this when the schema is unchanged is safe (push detects no changes).
# TODO(추후 과제): restore an append-only `pnpm db:migrate` flow — freeze 0000
# and stop regenerating its `when` — so schema sync becomes automatic and
# auditable again. Until then, this manual reviewed push is the contract.

# Cap V8 heap below total RAM so the build hits GC before the OOM-killer. On a
# 2GB box (+4GB swap) 1536MB leaves headroom for Postgres and the OS during build.
# 서브셸: 빌드가 NEXT_PUBLIC_* 를 인라인하도록 env 를 빌드에만 노출한다.
log "Building"
(
  set -a; . ./.env.production; set +a
  NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB:-1536}" pnpm build
)

# PM2 는 깨끗한 셸 env 에서 기동/리로드한다 — 앱 런타임 env 는 next start 가
# .env.production 에서 직접 읽는다. `--update-env` 를 쓰지 않는다: 셸에 export 된
# 값을 프로세스 env 로 캡처해 이후 파일 수정을 영구히 가리는 박제를 만든다.
log "Reloading PM2"
if pm2 describe bidit >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

log "Deploy complete. App on 127.0.0.1:3000 (Caddy serves it on 443)."
