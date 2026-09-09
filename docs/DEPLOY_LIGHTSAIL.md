# 배포 런북 — AWS Lightsail + Caddy (Amazon Linux 2023)

단일 Lightsail VM에 앱·DB·리버스프록시를 모두 올리는 **자체 호스팅** 경로다.

> **위치**: 이 문서가 **현행 라이브 배포 절차**다. 라이브 운영은 이 Lightsail 자체 호스팅으로 돌아간다.

## 아키텍처

```
인터넷 ──443──▶ Caddy (systemd, 자동 HTTPS/Let's Encrypt) ──┬─▶ 127.0.0.1:3000
                                                            │   Next.js (PM2: `next start`)
                                                            │         │
                                                            │   127.0.0.1:5432
                                                            │   Postgres 16 (docker compose)
                                                            │         ▲
                  /connection/* (wss 업그레이드) ───────────┴─▶ 127.0.0.1:8000
                                                                Centrifugo (docker compose)
                                                                  │ subscribe proxy
                                                                  └─(host.docker.internal)→ 앱 /api/centrifugo/subscribe
```

- **앱**: 네이티브 `next start`, PM2 가 감독 (`ecosystem.config.cjs`).
- **DB**: 같은 박스의 Docker Postgres (`docker-compose.prod.yml`), **`127.0.0.1` 에만 바인딩** → 외부 노출 없음. 앱은 `DATABASE_URL` 로 접속.
- **실시간(채팅)**: 같은 박스의 Docker Centrifugo (`docker-compose.prod.yml`, `deploy/centrifugo/config.yaml`), **`127.0.0.1:8000` 에만 바인딩**. 브라우저는 Caddy 의 `wss://<도메인>/connection/websocket` 로만 접속(직접 노출 없음). 앱은 `127.0.0.1:8000/api` 로 publish. 메시지 영속은 전적으로 Postgres(자사 보관) — Centrifugo 는 fanout 만, 아무것도 저장 안 함. 단일 PM2 fork → Memory engine, **Redis 불필요**(멀티노드 확장 시에만 Redis/Nats engine 도입).
- **프록시/TLS**: Caddy 가 도메인으로 Let's Encrypt 인증서를 자동 발급·갱신, 80→443 리다이렉트, 25MB 업로드 허용, `/connection/*` 를 Centrifugo 로 reverse_proxy(WS 업그레이드 투명 처리) (`deploy/Caddyfile`).
- **방화벽**: **Lightsail 콘솔 방화벽**만 사용. 호스트 방화벽(ufw/firewalld) 미설치 — 아래 §방화벽 참조.

## 사양 결정 (확정)

| 항목 | 값 | 근거 |
|---|---|---|
| OS | **Amazon Linux 2023** | glibc 2.34 → Node 22 공식 바이너리 네이티브 실행 (AL2의 glibc 우회 불필요) |
| 플랜 | **2GB RAM** ($10~12/mo) | 운영 ≈ DB 200MB + 앱 300MB + OS/Docker/Caddy 400MB ≈ 900MB, 여유 |
| swap | **2GB** | `next build` 피크(>1GB) 흡수. 2GB 박스라 thrashing 거의 없음 |
| 빌드 | **서버에서 직접** | bootstrap 후 deploy.sh 가 git pull→build. `--max-old-space-size=1536` 로 OOM 방지 |

## 사전 준비 (콘솔)

1. **Lightsail 인스턴스 생성**: 블루프린트 **Amazon Linux 2023**, 플랜 **2GB**. SSH 키 등록.
2. **고정 IP 연결**: Networking → Create static IP → 인스턴스에 attach (연결돼 있는 동안 무료).
3. **⚠️ 콘솔 방화벽 — 가장 흔한 함정**: 인스턴스 → **Networking → IPv4 Firewall** 에서
   - `SSH 22` (기본 존재 확인)
   - `HTTP 80` (기본 존재 확인 — Caddy ACME HTTP 챌린지/리다이렉트에 필요)
   - **`HTTPS 443` 추가** ← 이걸 안 열면 사이트가 안 뜬다.
4. **DNS**: 도메인 `A` 레코드를 위 **고정 IP** 로. (Caddy 시작 전에 전파돼 있어야 ACME 챌린지 성공.)
   - 확인: `dig +short your-domain.com` → 고정 IP 가 나와야 함.

## 서버 프로비저닝 & 첫 배포

> **레포는 private 이다.** 익명 HTTPS 클론/pull 이 동작하지 않으므로, 코드를 받기 전에
> 서버에 **read-only deploy key** 를 먼저 심어야 한다(아래 2단계). 이걸 건너뛰면
> `lightsail-deploy.sh` 의 `git pull` 단계에서 배포가 실패한다.

```bash
# 1) SSH 접속 (Lightsail AL2023 기본 사용자: ec2-user)
ssh -i ~/Downloads/LightsailDefaultKey.pem ec2-user@<STATIC_IP>

# 2) 레포 클론 — private 이라 deploy key 가 선행한다
sudo dnf install -y git

#    2-a) 서버 전용 키 생성 (passphrase 없음 — 배포 스크립트가 비대화식으로 돈다)
ssh-keygen -t ed25519 -C "lightsail-deploy@supporter-b" \
  -f ~/.ssh/id_ed25519_supporterb -N ""

#    2-b) GitHub 호스트키 고정. deploy 스크립트가 BatchMode 로 돌아 대화식 수락이
#         불가능하므로 미리 known_hosts 에 넣어 둔다.
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
ssh-keygen -lf <(ssh-keyscan -t ed25519 github.com 2>/dev/null)
#         ↑ 출력된 SHA256 지문을 GitHub 공식 목록과 대조할 것:
#           https://docs.github.com/en/authentication/keeping-your-account-secure/githubs-ssh-key-fingerprints

#    2-c) 호스트 별칭으로 배선한다. `Host github.com` 에 직접 걸지 않는 이유:
#         deploy key 는 GitHub 전체에서 레포 1개에만 붙일 수 있어, 같은 VM 에 다른
#         private 레포(admin 콘솔 등)를 추가할 때 IdentitiesOnly 가 충돌한다.
cat >> ~/.ssh/config <<'EOF'

Host github-supporterb
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_supporterb
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

#    2-d) 아래 공개키를 레포 Settings → Deploy keys 에 **read-only** 로 등록한다.
#         로컬(레포 admin 권한)에서:
#           gh repo deploy-key add <pub파일> --title "lightsail-prod (read-only)" \
#             -R bothsides-platform-dev/supporter-b
#         `--allow-write` 를 붙이지 않는다 — 서버는 pull 만 하면 되고, 쓰기 권한이
#         없어야 서버가 침해돼도 레포에 push 할 수 없다.
cat ~/.ssh/id_ed25519_supporterb.pub

#    2-e) 인증 확인 후 클론
ssh -T git@github-supporterb   # "Hi bothsides-platform-dev/supporter-b! ...authenticated"
git clone git@github-supporterb:bothsides-platform-dev/supporter-b.git bidit && cd bidit
git checkout <배포브랜치>      # 예: main

# 3) 1회 프로비저닝 — swap, Node22(공식 바이너리), pnpm, Docker, PM2, Caddy(systemd)
bash scripts/deploy/lightsail-bootstrap.sh
#    Docker 그룹 반영을 위해 한 번 재접속(또는 `newgrp docker`).
exit && ssh -i ... ec2-user@<STATIC_IP> && cd bidit

# 4) Caddy 도메인 지정 후 기동
sudo sed -i 's/your-domain.com/<YOUR_DOMAIN>/' /etc/caddy/caddy.env
sudo systemctl enable --now caddy
sudo systemctl status caddy          # active (running) 확인. 인증서 발급 로그: journalctl -u caddy -f

# 5) 운영 환경변수
cp .env.production.example .env.production
$EDITOR .env.production               # 아래 §환경변수 참조

# 6) 빌드 + 릴리스
bash scripts/deploy/lightsail-deploy.sh

# 7) 재부팅 후에도 살아남게
pm2 startup                           # 출력된 sudo 명령을 그대로 실행
pm2 save
```

## 환경변수 (`.env.production`)

`.env.production.example` 를 채운다. 핵심:

- `DATABASE_URL` — 같은 박스 Postgres: `postgresql://supporter_b:<POSTGRES_PASSWORD>@127.0.0.1:5432/supporter_b`
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — `docker-compose.prod.yml` 가 읽음. `DATABASE_URL` 의 자격증명과 **반드시 일치**.
- `AUTH_SECRET` — `openssl rand -base64 32`
- `AUTH_TRUST_HOST=true` — 프록시 뒤에서 Auth.js 가 호스트를 신뢰하도록
- `NEXT_PUBLIC_BASE_URL=https://<YOUR_DOMAIN>` — **빌드 타임에 인라인**되므로 deploy(빌드) 전에 설정
- `NEXT_PUBLIC_BUYER_ORIGIN` / `NEXT_PUBLIC_PARTNER_ORIGIN` — 호스트 라우팅(buyer ↔ partner 서브도메인)용. **both-or-neither**: 둘 다 설정하거나 둘 다 비운다. 하나만 설정하면 `appOrigins()` 가 throw 해 앱이 뜨지 않는다(v0.4.3.0~ fail-closed). 상세와 컷오버 절차는 아래 "partner.support-b.com 서브도메인 (PG 호스트 라우팅) 롤아웃" 절 참조. **빌드 타임 인라인**.
- **Centrifugo(채팅)** — `CENTRIFUGO_TOKEN_HMAC_SECRET`, `CENTRIFUGO_API_KEY` 는 `openssl rand -base64 48` 로 강하게 생성. **이름 브리지 주의**: 이 값들은 `docker-compose.prod.yml` 가 컨테이너에 v6 환경변수명(`CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY` / `CENTRIFUGO_HTTP_API_KEY`)으로 다시 주입한다 — **한 번만 설정하면 앱과 컨테이너가 같은 값을 공유**. `CENTRIFUGO_HTTP_API_URL=http://127.0.0.1:8000/api`, `NEXT_PUBLIC_CENTRIFUGO_WS_URL=wss://<YOUR_DOMAIN>/connection/websocket`(빌드 타임 인라인 — deploy 전에 설정). 컨테이너의 `allowed_origins` 는 `APP_DOMAIN` 에서 자동 도출.
- `AXIOM_TOKEN` / `AXIOM_DATASET` — 둘 다 설정하면 운영 로그(pino)가 Axiom으로 전송된다. 미설정 시 `pm2 logs bidit` 으로만 확인.
- **마스터/운영자 계정 (Google OAuth 전용)** — `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`(Google OAuth 클라이언트, 승인된 리디렉션 URI = `https://support-b.com/api/auth/callback/google` 1개), `MASTER_ACCOUNT_EMAILS`(쉼표로 구분된 운영자 Google 이메일 allowlist — 복수 가능), `NEXT_PUBLIC_MASTER_OAUTH_ENABLED=true`(숨겨진 `/login/ops` 라우트 활성화 — **빌드 타임 인라인**, deploy 전 설정). 라우트는 이 플래그가 true이고 `AUTH_GOOGLE_ID` 도 설정됐을 때만 렌더(아니면 404). 운영자는 `/login/ops` 주소를 직접 입력해 Google로만 로그인하며, allowlist에 없는 Google 계정은 거부된다. **보안 경계는 라우트 404가 아니라 allowlist default-deny** — `AUTH_GOOGLE_ID` 가 설정된 한 OAuth 콜백 엔드포인트는 플래그와 무관하게 존재하지만 allowlist 이메일만 로그인 완료 가능. 기능을 완전히 끄려면 `AUTH_GOOGLE_ID` 를 비운다. **시드 스크립트 불필요** — 최초 로그인 시 users 행이 자동 생성된다. `AUTH_GOOGLE_ID` 가 비어 있으면 Google 프로바이더 자체가 비활성. 스키마는 `is_master` 컬럼 없이 env allowlist 로만 판정하므로 추가 DDL 은 `workspaces_status_idx`(additive) 뿐.
- `RESEND_*`, `SENTRY_*`, `SOLAPI_*` 등 — 사용하는 것만

## 갱신 배포 (이후 매번)

```bash
cd bidit && bash scripts/deploy/lightsail-deploy.sh
```
git pull → install → DB 기동 대기 → build → `pm2 reload` (무중단 reload). Caddy 는 건드리지 않음.

> `git pull` 은 위 §서버 프로비저닝 2단계의 deploy key 로 인증한다. 스크립트는 `GIT_TERMINAL_PROMPT=0`
> + `ssh -o BatchMode=yes` 로 돌기 때문에, 인증이 깨지면 자격증명 프롬프트에서 **멈추는 대신 즉시 실패**한다.
> 복구는 §트러블슈팅의 "git 단계에서 인증 실패" 항목 참조.

### 기존 서버를 HTTPS → SSH 로 옮기기 (public → private 전환 시 1회)

레포가 public 이던 시절 익명 HTTPS 로 클론된 서버는 remote 를 바꿔야 한다. **visibility 를 뒤집기
전에** 하는 것이 핵심이다 — SSH 인증은 public 레포에도 그대로 동작하므로, 먼저 배선하고 검증한
뒤 private 으로 바꾸면 배포가 끊기는 창이 생기지 않는다.

```bash
# 서버에서 — 위 §프로비저닝 2-a ~ 2-d 로 키를 만들고 등록한 다음
cd ~/bidit
git remote -v                                   # 현재 HTTPS 인지 확인
git remote set-url origin git@github-supporterb:bothsides-platform-dev/supporter-b.git
ssh -T git@github-supporterb                    # 레포 이름으로 인증되는지
git fetch --dry-run && echo "SSH fetch OK"      # ← 이게 통과해야 다음으로 간다
```

여기까지 green 이면 로컬에서 visibility 를 뒤집고, 서버에서 다시 `git fetch` + 배포 1회로 확인한다.

```bash
gh repo edit bothsides-platform-dev/supporter-b --visibility private --accept-visibility-changes
```

> 스키마 변경 시: 배포 **전에** `pnpm db:push` 로 수동 적용(계획 검토 — additive 면 적용, DROP/데이터 영향 구문은 중단). deploy 스크립트는 스키마를 자동 동기화하지 않는다. (migrate 정식 복귀는 추후 과제)

> **v0.6.1.0 (워크스페이스 이름 변경 심사) — 양쪽 앱 배포 전에 additive DDL을 먼저 적용한다**:
> 고객 앱과 운영자 콘솔이 새 요청 테이블을 직접 읽으므로, 테이블 없이 앱을 먼저 배포하면
> 설정 프로필과 이름 변경 심사 화면이 실패한다. DDL은 기존 테이블을 바꾸지 않아 구 버전과
> 함께 동작한다.
> ```bash
> psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
>   -f docs/migrations/2026-09-workspace-name-change-requests.sql
> # 그 다음 bidit과 admin-supporter-b를 배포한다.
> ```

> **v0.5.7.0 (채팅 읽음 워크스페이스 격리) — 전용 SQL 직후 앱을 배포한다**:
> 읽음 커서는 이제 `(conversation_id, workspace_id, user_id)` 로 식별된다. 기존 행은
> 읽을 당시 워크스페이스를 증명할 수 없어 전부 fail-closed 로 초기화한다(안 읽음 표시는
> 다시 생길 수 있지만 거짓 읽음은 만들지 않는다). 구 앱은 새 NOT NULL 컬럼을 쓰지 못하므로
> SQL과 앱 배포 사이를 벌리지 않는다.
> ```bash
> psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
>   -f docs/migrations/2026-09-chat-read-workspace-scope.sql
> bash scripts/deploy/lightsail-deploy.sh
> ```

> **v0.4.42.0 (전자서명 하드닝) — 배포 전에 additive 컬럼 2개를 먼저 넣는다**: 신코드가
> `signing_contracts.last_reminded_at`(리마인더 쿨다운)·`signing_participants.email_delivery`
> (반송 미러)를 **무조건** SELECT/INSERT 한다(`findById` 가 projection 없는 `.select()` —
> Drizzle 이 스키마 전 컬럼으로 전개). 컬럼 없이 앱이 먼저 나가면 딜룸 계약 탭·폴링 cron·
> 웹훅 reconcile 이 전부 `column does not exist` 로 실패한다 — 특히 `patchParticipant` 가
> reconcile 트랜잭션을 통째로 깨 **모든 계약의 상태 동기화가 멈춘다**. 반대로 DDL 은
> additive nullable 이라 구코드에는 무해(정상 공존).
> ```bash
> # 1) 배포 전 — DDL (멱등, 재실행 안전)
> psql "$DATABASE_URL" <<'SQL'
> SET lock_timeout = '3s'; SET statement_timeout = '30s';
> ALTER TABLE signing_contracts ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;
> ALTER TABLE signing_participants ADD COLUMN IF NOT EXISTS email_delivery text;
> SQL
> # 2) 배포
> bash scripts/deploy/lightsail-deploy.sh
> ```

> **초안 출처 게이트(이 릴리스) — 배포 전에 additive 컬럼 1개를 먼저 넣는다**:
> `DrizzleSigningContractRepository` 는 `signing_contracts` 를 읽는 거의 모든 메서드
> (`findById`·`findActiveByRfp`·`findByRfp`·`findByProviderRef`·`findPollable`)가
> **명시 컬럼을 나열하지 않는 `.select()`** 를 쓴다 — 드리즐이 이걸 스키마의 전체
> 컬럼을 나열하는 SQL 로 펼치므로, DB 에 `provider_draft_origin` 이 없으면 이 쿼리들이
> **전부** `column "provider_draft_origin" does not exist` 로 즉시 깨진다(`bindDraftRef`
> 도 같은 컬럼에 SET 한다). **이건 `CONTRACT_TEMPLATES_ENABLED` 뒤에 있지 않다** —
> `getForActor`(양측 딜룸 **계약** 탭, 선정된 모든 RFP), `onAward`(선정 훅), 폴링
> cron(`findPollable`), 웹훅 리졸버(`findByProviderRef`)가 전부 이 경로를 타므로,
> DDL 없이 앱이 먼저 나가면 **선정된 모든 딜의 서명 표면이 즉시 500** 이다(계약서
> 템플릿 지름길만의 문제가 아니다) — 플래그로 미뤄지는 것이 아니라 배포 순간 바로
> 터진다(v0.4.42.0 이 바로 이 모양의 사고였다). 반대로 이 DDL 은 additive nullable
> 이라 구코드에는 무해(정상 공존).
>
> NULL 은 "출처 미상"으로 읽혀 **재사용 불가**(fail-closed)다. 진행 중인 딜에 미치는
> 영향은 "재시도가 초안을 재사용하지 않고 새로 만든다" 뿐이며(발송 전이라 메일·쿼터 0),
> 그 대상 행 수는 배포 전에 세어 둔다:
> ```sql
> SELECT count(*) FROM signing_contracts
>  WHERE status = 'awaiting_pg_template' AND provider_ref IS NOT NULL;
> ```
> v0.4.55.0 부터는 이 카운트가 0 이 아니어도 파괴 경로가 없다(블라인드 ref-clear 가
> 기대 ref + awaiting CAS 로 전환 — 레거시 행이 경합에 걸리면 삭제 대신
> `CONTRACT_BUSY` 로 물러난다). 정직성 체크로 유지하고, 0 이 아니면 행 목록만
> 확인해 둔다. v0.4.55.0(하드닝)·v0.4.56.0(템플릿 재활성화) 배포에는 새 DDL 이 없다.
> ```bash
> # 1) 배포 전 — DDL (멱등, 재실행 안전)
> psql "$DATABASE_URL" <<'SQL'
> SET lock_timeout = '3s'; SET statement_timeout = '30s';
> ALTER TABLE signing_contracts ADD COLUMN IF NOT EXISTS provider_draft_origin text;
> SQL
> # 2) 배포
> bash scripts/deploy/lightsail-deploy.sh
> ```
> ⚠️ 워크트리에서 `pnpm db:push` 를 그냥 돌리지 말 것 — 로컬 5432 를 워크트리들이 공유해
> 다른 브랜치가 추가한 컬럼을 DROP 한다. 로컬도 위 `ALTER TABLE` 한 줄만 손으로 적용한다.

> **계약서 템플릿 재도입(PR#470 포함 릴리스) — 배포 **전에** re-add DDL 을 실행한다
> (⚠️ v0.4.37.0 드랍과 순서가 반대)**: PR#470 이 `pg_signing_templates` 와
> `bids.signing_template_id` 를 **신형 스키마로** 다시 쓴다. 신코드는 이 표를 조건 없이
> 읽는다 — PG 딜룸 진입(`loadPgRfpDetail`)과 견적 제출이 이 표를 조회하므로, 표 없이
> 배포하면 **PG 딜룸·견적 제출이 500** 난다(PM2 단일 fork, 롤링 창 없음; 홈·게시판
> 목록은 이 표를 안 봐 살아 있다). 반대로 이 DDL 은 additive 라 구코드에는 무해하다 —
> 그래서 드랍 때와 순서가 뒤집힌다.
> ```bash
> # 1) 배포 전 — re-add DDL (멱등, 재실행 안전)
> #    구형 표(role_mapping 보유)가 살아 있으면 스크립트가 스스로 RAISE 로 멈춘다
> #    (사람이 \d 를 읽는 데 기대지 않는다). 멈추면 중단하고 상태를 보고할 것.
> psql "$DATABASE_URL" -f docs/migrations/2026-08-readd-signing-templates.sql
> # 2) 배포
> bash scripts/deploy/lightsail-deploy.sh
> ```
> `backup.pg_signing_templates_backup` 은 **복원하지 않는다**(구형 스키마·외부 링크
> 모델의 산물 — 신코드와 안 맞는다). 그대로 뒀다가 드랍 스크립트 하단 절차대로 폐기 —
> 드랍 스크립트에는 신형 표를 보면 멈추는 가드가 들어가 있어(2026-08 추가), backup 표를
> 폐기한 뒤 실수로 드랍을 재실행해도 재도입 표를 지우지 못한다.
> 적용 후 `pnpm db:push` 계획은 이 표·컬럼에 대해 no-op 이어야 한다 — 로컬 리허설
> 실측: push 계획에 이 표·컬럼 관련 구문 0건(늘 재제안되는 무관 항목만 나옴:
> `workspace_invitations` 표현식 인덱스·`notifications` desc 인덱스·`::text` 디폴트류.
> 그것들이 나오는 것은 정상이고, `pg_signing_templates`/`bids.signing_template_id` 가
> 계획에 보이면 그때가 비정상이다).
>
> **계약 보관함 + 발송 스냅샷 + 대기 알림 (v0.5.3.0) — 배포 전에 DDL 을 먼저 실행한다**:
> 이 컷은 스키마를 세 군데 건드린다 — 신규 표 `contract_archives`,
> `signing_contracts.sent_document jsonb`, 그리고 `outbox_event` enum 의 새 값
> `signing.awaiting_template`.
> ```bash
> # 1) 배포 전 — DDL (멱등, 재실행 안전)
> psql "$DATABASE_URL" -f docs/migrations/2026-08-contract-archives.sql
> # 2) 배포
> bash scripts/deploy/lightsail-deploy.sh
> ```
> ⚠️ **`pnpm db:push` 를 쓰지 않는다 — 이 컷에서는 위험하다.** 배포 스크립트가
> `git pull --ff-only` 를 **자기 안에서** 하므로(`lightsail-deploy.sh:31`), 배포 전에
> push 를 돌리면 drizzle-kit 이 **옛 스키마 파일**을 읽는다. 결과가 둘 다 나쁘다:
> `contract_archives` 는 안 만들어지는데 계획서는 "변경 없음"이라 **거짓 초록**이고,
> enum 은 **되돌리는** 계획이 나온다(실측: `DROP TYPE` 후 새 값 없이 `CREATE TYPE`
> 재생성 → `onAward` 알림이 다시 깨지거나, 이미 그 값을 쓴 행이 있으면 USING 캐스트
> 실패). 앞선 두 서명 릴리스가 `.sql` 파일을 쓴 이유가 이것이다 — **pull 을 안 했으면
> 시끄럽게 실패한다.** 인라인 `psql -c` 는 그 강제력이 없다.
>
> 왜 순서가 중요한가:
> - **쓰기** — `markSentIfAwaiting` 이 `sent_document` 를 **무조건** SET 한다. 이 메서드는
>   조항형만이 아니라 **모든 발송·바인딩 경로**의 커밋 지점이다(임베드 attach·복구
>   다이얼로그·자가치유·템플릿 지름길·조항형). 컬럼이 없으면 공급자에 계약을 만들고
>   **서명 요청 메일까지 나간 뒤** 커밋에서 실패해, 계약은 살아 있는데 우리 쪽은
>   awaiting 에 남는 반쪽 상태가 된다.
> - **읽기** — `SIGNING_CONTRACT_COLUMNS` 명시 projection 이 `sent_document` 를 조건 없이
>   SELECT 한다. 컬럼이 없으면 딜룸 계약 탭·폴러·웹훅이 **행이 0건이어도 파스 타임에**
>   깨진다. v0.4.42.0 과 같은 모양이다.
> - **알림** — enum 값이 없으면 `onAward` 의 알림 팬아웃이 트랜잭션 안에서
>   `invalid input value for enum` 으로 죽어 **계약 대기 생성 자체가 실패**한다.
> - **cron** — `contract_archives` 가 없으면 `poll-signing-status` 의 보관 스텝(자체 try
>   로 감싸 폴링 본체는 살아 있다)과 `sweep-uploads` 의 보관 스텝(역시 자체 try)이 매 틱
>   에러를 뿜는다.
>
> ⚠️ **유닛 테스트가 초록인 것은 이 단계를 건너뛸 근거가 못 된다.** `lib/db/schema-ddl.ts`
> 가 스키마 정의에서 greenfield DDL 을 **자동 생성**하므로 PGlite 는 컬럼·표가 늘 있는
> 상태로 뜬다. 운영 DB 만 `ALTER`/`CREATE` 가 필요하고, 그 비대칭이 v0.4.42.0 사고의 구조다.
>
> **조항형 계약서 서식(이전 릴리스) — 배포 전에 DDL 을 먼저 실행한다**:
> 스크립트가 두 표를 건드린다 — `pg_signing_templates`(조항형 서식 컬럼 + CHECK)와
> `signing_contracts.stale_notified_at`(마감 없는 계약의 방치 알림 스로틀 마커). 뒤쪽은
> additive nullable 이고 구코드가 보지 않으므로 순서 부담이 없다. 앞쪽이 순서를 정한다:
> `DrizzlePgSigningTemplateRepository` 의 `TEMPLATE_COLUMNS` 는 **명시 projection** 이라
> `kind`·`document`·`updated_at` 을 무조건 SELECT 한다. 컬럼 없이 앱이 먼저 나가면
> `listByWorkspace` 를 호출하는 **PG 딜룸과 견적 제출 화면이 파스 타임에 500** 이 된다 —
> 행이 0건이어도 그렇다. v0.4.42.0 운영 500 과 **같은 모양**이다.
> ```bash
> # 1) 배포 전 — DDL (멱등, 재실행 안전)
> psql "$DATABASE_URL" -f docs/migrations/2026-08-composed-signing-templates.sql
> # 2) 배포
> bash scripts/deploy/lightsail-deploy.sh
> ```
> ⚠️ **`pnpm db:push` 계획서에 `DROP NOT NULL` 이 맨 앞에 뜨는데, 이것은 위 기본 규칙이
> 말하는 "DROP → 중단" 이 아니다.** 규칙이 막으려는 것은 컬럼·테이블·데이터가 사라지는
> 구문이고, 여기 나오는 것은 `snowsign_template_id` 의 **NOT NULL 제약만** 푸는 구문이다
> (조항형 행은 provider 템플릿 id 가 없으므로 필요하다). 데이터는 하나도 지워지지 않고
> 구코드에도 무해하다 — 구코드는 그 컬럼을 항상 채워 넣기 때문에 제약이 없어도 동작이
> 같다. 규칙을 문자 그대로 적용해 여기서 중단하면, DDL 없이 앱만 나가 위의 500 이 난다.
> 그래서 이 릴리스는 push 대신 위 `.sql` 을 쓴다(스크립트가 순서·락 타임아웃·멱등성을
> 이미 담고 있다).
>
> 롤백은 스크립트 하단 절차를 **그 순서대로** 따른다 — 조항형 행을 먼저 지운 뒤 코드를
> 되돌린다. 순서를 뒤집으면 구코드가 `kind` 를 모른 채 조항형 행을 PDF 서식으로 읽어
> 서식 목록·견적 위저드 피커에 `snowsignTemplateId: null` 인 행이 섞인다.
>
> **v0.4.38.0 — 이 릴리스에서는 `pnpm db:push` 를 쓰지 않는다 (⚠️ 위 기본 규칙의 예외)**:
> 이 컷의 스키마 파일은 `signing_contracts` 에 컬럼을 **더하는 동시에**
> `pg_signing_templates` 테이블과 `bids.signing_template_id` 를 **없앤다.** 그래서 push 의
> 계획서 한 장에 additive 와 DROP 이 섞여 나오고, 위의 "additive 면 적용, DROP 이면 중단"
> 규칙이 어느 쪽으로도 안전하지 않다:
> - 계획을 **적용**하면 → 배포 전에 테이블이 사라져 구코드(0.4.36.1)의 bare `.select()` 가
>   즉시 깨진다(단일 PM2 fork 라 흡수할 워커가 없다). 게다가 push 는 **생짜로 DROP** 해서
>   아래 롤백이 의존하는 `backup` 스냅샷을 뜨지 않는다.
> - 계획을 **중단**하면 → 신규 컬럼이 안 생겨, 배포된 새 코드가 없는 `recovery_refs`
>   (NOT NULL)를 읽고 전자서명 표면 전체가 깨진다.
>
> 그래서 이 릴리스만 **additive DDL 을 손으로 먼저 적용**하고 push 는 건너뛴다. 배포 전에:
> ```sql
> -- 0) 유니크 인덱스 사전점검 — 0행이어야 한다. 나오면 손으로 정리한 뒤 진행한다
> --    (구매사가 보고 있는 딜룸의 행을 남긴다).
> SELECT provider_ref, count(*) FROM signing_contracts
>  WHERE provider_ref IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
>
> -- 1) additive DDL (배포 전, 구코드에 무해)
> SET lock_timeout = '3s'; SET statement_timeout = '30s';
> ALTER TABLE signing_contracts
>   ADD COLUMN IF NOT EXISTS claimed_for_send_by uuid REFERENCES users(id),
>   ADD COLUMN IF NOT EXISTS recovery_refs text[] NOT NULL DEFAULT '{}';
> CREATE UNIQUE INDEX IF NOT EXISTS signing_contracts_provider_ref_uniq
>   ON signing_contracts (provider_ref) WHERE provider_ref IS NOT NULL;
>
> -- 2) 옛 비유니크 인덱스는 위 유니크 인덱스가 대체한다(스키마 파일에서 빠졌다).
> --    지우지 않아도 동작에는 무해하지만, 남겨두면 다음 릴리스의 db:push 계획에
> --    이 DROP 이 튀어나와 또 "섞인 계획서"를 만든다. 여기서 정리한다.
> DROP INDEX IF EXISTS signing_contracts_provider_ref_idx;
> ```
> 유니크 인덱스는 아래 drop 스크립트 말미에도 `IF NOT EXISTS` 로 들어 있어 어느 쪽으로
> 적용해도 무해하다. **신규 컬럼 둘은 저 스크립트에 없다** — 여기서 안 만들면 어디서도
> 안 만들어진다. 롤백 시에는 앱만 되돌리고 컬럼·인덱스는 그대로 둔다(구코드에 무해).
> 다음 릴리스부터는 스키마가 다시 순수 additive 라 평소대로 `pnpm db:push` 로 돌아간다.
>
> 위 SQL 이 이 릴리스의 additive 스키마 델타 **전부**다(스키마 파일 diff 기준: 신규 컬럼
> 둘 + 유니크 인덱스 교체). 나머지 변경은 전부 DROP 이고 아래 배포 후 스크립트가 소유한다.
>
> enum **값 rename** 등 `db:push` 가 안전하게 못 하는 변경은 `docs/migrations/*.sql` 에
> 커밋된 스크립트를 **`db:push` 보다 먼저** psql 로 적용한다. 예: v0.2.35.0 의
> `merchant_grade` 영세 값 `small`→`sole` 통일은
> `docs/migrations/rename-merchant-grade-small-to-sole.sql` 을 먼저 실행해야 push 가
> enum diff 를 보지 않는다(미적용 시 push partial-fail + 기존 'small' row 고립).
>
> **v0.4.2.0 enum ADD VALUE**: `signing_contract_status` 에 `send_failed`(전자서명 발송
> 실패 상태)를 추가한다 — `docs/migrations/2026-07-add-send-failed-signing-status.sql`
> (`ALTER TYPE … ADD VALUE IF NOT EXISTS`)을 **`db:push`·배포 전에** psql 로 적용한다.
> (v0.4.33.0 이후 이 값을 **쓰는 코드는 없다** — 리스 CAS 도입으로 발송 실패는 계약을
> awaiting 에 남기고 클레임만 푼다. enum 값은 그 이전에 쌓인 레거시 행을 딜룸이 그리기
> 위해 유지하므로, 신규 환경 구축 시에도 여전히 적용해야 한다.)
>
> **⚠️ 아래 v0.4.37.0·v0.4.33.0 두 절은 이미 집행된 과거 릴리스 절차다 — 재실행 금지.**
> 특히 v0.4.37.0 드랍 스크립트는 PR#470 이 같은 이름의 표를 **신형으로 재도입**한 뒤라,
> 재실행하면 살아 있는 표를 지우는 스크립트가 된다. 스크립트 자체에 신형 표를 보면
> RAISE 로 멈추는 가드를 넣어 두었지만(2026-08), 이 절들은 이력 참조용으로만 읽는다.
>
> **v0.4.37.0 계약서 템플릿 폐지 — 배포 후 1회 실행 (집행 완료, 이력 참조용)**:
> 재사용 템플릿이 없어지고 PG 가 딜룸 임베드에서 건별로 계약서를 올려 보내는 방식으로
> 바뀌었다. `pg_signing_templates` 테이블과 `bids.signing_template_id` 를 지운다.
> 구버전 코드의 템플릿 repo 가 이 테이블을 bare `.select()` 로 읽으므로 **먼저 지우면
> `/signing-templates` 페이지·견적 위저드 픽커·딜룸 발송이 전부 깨진다.** PM2 는
> `instances: 1, fork` 라 진짜 롤링 창이 없다.
> ```bash
> # 1) 배포 (pm2 reload 까지 끝난 것 확인)
> bash scripts/deploy/lightsail-deploy.sh
> # 2) 배포 후 — 테이블·컬럼 DROP (비가역, 백업 표를 먼저 뜬다)
> psql "$DATABASE_URL" -f docs/migrations/2026-08-drop-signing-templates.sql
> ```
> 스크립트가 백업본을 먼저 확보하므로 롤백 창이 있다(복원 절차는 파일 상단 주석).
> 백업은 둘 다 **`backup` 스키마**에 있다 — `public` 에 두면 다음 `db:push` 가 스키마
> 파일에 없는 표라며 지워버리기 때문이다. 이름과 만들어지는 방식이 서로 다르니 롤백 때
> 헤매지 않도록:
> - `backup.pg_signing_templates_backup` — 원본을 **RENAME + SET SCHEMA** 한 것(제약·인덱스가
>   그대로 따라온다. 그래서 롤백의 `REFERENCES` 가 성립한다).
> - `backup.bids_signing_template` — `(id, signing_template_id)` 만 뜬 CTAS 사본.
>
> 롤백 창이 지나면 두 표를 수동으로 지운다.
> `signing_contracts.snowsign_template_id` 는 **남긴다** — 이미
> 발송된 옛 계약이 어떤 계약서를 썼는지 가리키는 이력이다.
>
> **v0.4.33.0 견적별 계약서 템플릿 — 2단계 수동 마이그레이션 (⚠️ `db:push` 를 배포보다
> 먼저 하면 안 된다)**: `pg_signing_templates.is_default` 가 DROP 된다. 구버전 코드의
> 템플릿 repo 는 전부 bare `.select()` 라 drizzle 이 `is_default` 를 포함한 명시 컬럼
> 목록으로 펼치므로, 컬럼을 먼저 지우면 award 경로뿐 아니라 `/signing-templates`
> 페이지·템플릿 링크 등 **모든** 템플릿 조회가 깨진다. PM2 는 `instances: 1, fork` 라
> 진짜 롤링 창이 없고 구코드가 재시작 전까지 계속 트래픽을 받는다.
> ```bash
> # 1) 배포 전 — 컬럼 추가 + 기존 대기 딜 백필 + is_default 백업 (통째로 실행 안전)
> psql "$DATABASE_URL" -f docs/migrations/2026-07-per-bid-signing-template-1-expand.sql
> # 2) 배포
> bash scripts/deploy/lightsail-deploy.sh   # pm2 reload 까지 끝난 것 확인
> # 3) 배포 후 — is_default DROP (비가역)
> psql "$DATABASE_URL" -f docs/migrations/2026-07-per-bid-signing-template-2-drop.sql
> ```
> 1단계는 멱등이라 재실행 안전하다. 3단계 이후 앱 롤백이 필요하면 1단계가 만든
> `pg_signing_templates_is_default_backup` 표로 컬럼을 복원해야 한다(파일 상단 주석 참조).
> `db:push` 는 3단계까지 끝난 뒤에 쓰면 no-op 이다.
>
> **v0.2.54.0 one-shot migration**: 칸반 '선정 완료' 컬럼이 '마감'으로 통합됨. 기존 워크스페이스에 남아 있는 `lifecycle_key='awarded'` 컬럼을 정리하려면 배포 후 1회 실행:
> ```bash
> cd bidit && tsx scripts/remove-awarded-kanban-columns.ts
> ```
> 멱등 스크립트 — 재실행 안전. 카드 FK는 `ON DELETE SET NULL` 이라 `resolveCardColumn` 이 lifecycle 에서 컬럼을 재도출해 자동 복구된다.
>
> **DB 샘플 시딩 시스템 제거 (virtual-sample-onboarding stage 3)**: 온보딩 샘플 체험이
> DB 시딩(`rfps.is_sample`/`workspaces.is_demo`/`workspaces.sample_seeded_at`)에서
> 클라이언트 fixture(`lib/onboarding/fixtures.ts`)로 전환됨 — 3개 컬럼이 DROP된다.
> 배포 순서(반드시 이 순서로 — **`db:push`를 배포보다 먼저 하면 안 된다**: 컬럼을
> 먼저 지우면 아직 떠 있는 구버전 코드(`WorkspaceRepo.listForUser`/`search` 등이
> `is_demo` 를 SELECT)가 "column does not exist" 로 즉시 깨진다 — 워크스페이스
> 스위처는 인증된 모든 페이지의 셸 레이아웃에서 조회되므로 전 사용자 장애로 번진다):
> 1. `docs/migrations/2026-07-cleanup-sample-data.sql` 을 psql 로 먼저 실행 — ① expand:
>    `users.onboarding` jsonb ADD COLUMN(새 코드가 `/rfp`·`/inbox` 매 요청마다 읽으므로
>    배포 전에 반드시 존재해야 한다; additive 라 구버전 코드에는 무해) + ② 기존 시더가
>    남긴 샘플 RFP/데모 워크스페이스/데모 유저/데모 biz_profile DML 정리(`is_sample`/
>    `is_demo` 컬럼이 아직 존재하는 상태에서 실행해야 하므로 반드시 이 단계에서).
> 2. 평소대로 배포(이 커밋) — 새 코드는 `is_sample`/`is_demo`/`sample_seeded_at` 를
>    더 이상 읽지 않으므로, 컬럼이 아직 DB에 남아 있어도 무해하다.
> 3. 배포(빌드+`pm2 reload`)가 끝난 뒤에만 `pnpm db:push` — 3개 컬럼 DROP(계획에 다른
>    additive 변경이 섞여 있어도 이 DROP 들은 의도된 것이므로 승인).

## 운영

| 작업 | 명령 |
|---|---|
| 앱 로그 | `pm2 logs bidit` |
| 앱 상태/재시작 | `pm2 status` / `pm2 reload bidit` |
| Caddy 로그/리로드 | `journalctl -u caddy -f` / `sudo systemctl reload caddy` |
| DB 셸 | `docker compose -f docker-compose.prod.yml exec pg psql -U supporter_b` |
| DB 백업 | `docker compose -f docker-compose.prod.yml exec -T pg pg_dump -U supporter_b supporter_b > backup-$(date +%F).sql` |
| Centrifugo 로그 | `docker compose -f docker-compose.prod.yml logs -f centrifugo` |
| Centrifugo 재시작 | `docker compose -f docker-compose.prod.yml restart centrifugo` (config.yaml 변경 후) |
| swap 확인 | `swapon --show` / `free -h` |
| 롤백 | `git checkout <이전-sha> && bash scripts/deploy/lightsail-deploy.sh` |

## 방화벽 — 호스트 방화벽을 두지 않는 이유

자체호스팅 시 흔히 iptables 를 손대지만 **Lightsail 은 불필요**하다:

- **Lightsail 콘솔 방화벽**(Networking 탭)이 AWS 엣지에서 Security Group 처럼 필터링한다 = 이게 방화벽이다.
- Amazon Linux 2023 은 ufw 가 없고(Debian 계열 도구), firewalld 도 Lightsail 이미지에서 기본 비활성. nftables 기본 정책은 ACCEPT 라 수동 룰 삽입도 불필요.
- 외부 리스너는 Caddy(80/443, 의도적 공개)와 SSH(22, 콘솔에서 관리)뿐. Postgres 는 `127.0.0.1` 바인딩이라 외부에서 보이지 않는다 → 호스트 방화벽이 추가로 막을 대상이 없다.

→ §사전준비 3번(콘솔에서 443 열기)만 하면 끝. 호스트 방화벽 설치 단계는 의도적으로 없다.

## Centrifugo (실시간 채팅)

`docker-compose.prod.yml` 의 `centrifugo` 서비스가 `pg` 와 함께 뜬다 (`docker compose -f docker-compose.prod.yml up -d` 가 둘 다 기동). 운영 시 따로 챙길 것:

- **포트 노출 없음**: `127.0.0.1:8000` 바인딩이라 Lightsail 콘솔 방화벽에 **8000 을 열지 않는다**. 외부는 오직 Caddy `wss://<도메인>/connection/websocket` 로만 도달.
- **subscribe proxy = 보안 경계**: 컨테이너가 구독 시도마다 앱(`host.docker.internal:3000/api/centrifugo/subscribe`)을 server↔server 로 호출해 워크스페이스 멤버십 ACL 로 허용/거부한다. 이 경로는 공개 노출 대상이 **아니다**(Caddy 미경유). `host.docker.internal` 는 compose 의 `extra_hosts: host-gateway` 로 Linux/Lightsail 에서 호스트로 매핑됨.
- **config.yaml 변경 후 재시작 필요**: `deploy/centrifugo/config.yaml` 은 read-only 마운트라 컨테이너 재시작(`docker compose -f docker-compose.prod.yml restart centrifugo`)으로 반영.
- **presence ACL 컷오버 순서 (2026-07-23 관계 게이트 전환)**: presence 네임스페이스가 subscribe-proxy 를 타므로 **앱 먼저 배포 → centrifugo 재시작** 순서를 지킨다. 역순이면 구 앱이 presence 구독을 전부 거부해 재시작~앱 배포 사이 전 플랫폼 점이 꺼진다. 재시작 후 확인: 관계 계정 2종(대화/초대 상대)의 점이 켜지고, 무관 계정의 raw 클라이언트 구독은 거부되는지. 롤백은 config 의 presence 블록 되돌리기 + 재시작 — 단 그것은 공개 모델(관찰자 신원 노출, `docs/THREAT_MODEL.md` §2.3) 복원이므로 의식적 보안 결정으로만.
- **시크릿은 env 만**: config.yaml 에 시크릿 리터럴 없음. 스칼라 키는 Centrifugo 가 `${VAR}` 를 보간하지 않아 env 키명 주입(`CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY` 등)을 쓰고, **유일한 예외로 map 필드(proxy `http.static_headers`)는 v6.3.0+ 가 `${CENTRIFUGO_VAR_*}` 를 보간**한다 — proxy secret 은 이 경로(`CENTRIFUGO_VAR_PROXY_SECRET`, compose 브리지)로 들어간다. `.env.production` 의 `CENTRIFUGO_*` 를 compose 가 주입. §환경변수 참조.

### 로컬 dev — Centrifugo 한 컨테이너

운영 compose 는 Postgres+Centrifugo 를 묶지만 로컬 dev 에서는 **Centrifugo 만** 따로 띄우면 된다 (앱은 `pnpm dev`, DB 는 기존 로컬 방식). 기본 경로는 dev compose 의 realtime 프로필:

```bash
docker compose --profile realtime up -d centrifugo
```

(`docker-compose.yml` 이 `deploy/centrifugo/config.yaml` 을 마운트하고 dev 기본 env — `dev-secret`/`dev-api-key`/`http://localhost:3000` — 와 `CENTRIFUGO_VAR_PROXY_SECRET` 브리지까지 주입한다.) compose 없이 단독 실행이 필요하면 동등한 `docker run`:

```bash
docker run --rm -p 127.0.0.1:8000:8000 \
  -v "$PWD/deploy/centrifugo/config.yaml:/centrifugo/config.yaml:ro" \
  -e CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY=dev-secret \
  -e CENTRIFUGO_HTTP_API_KEY=dev-api-key \
  -e CENTRIFUGO_CLIENT_ALLOWED_ORIGINS=http://localhost:3000 \
  -e CENTRIFUGO_VAR_PROXY_SECRET="${CENTRIFUGO_PROXY_SECRET:-}" \
  --add-host host.docker.internal:host-gateway \
  centrifugo/centrifugo:v6 centrifugo -c /centrifugo/config.yaml
```

그리고 `.env.local` 에:

```
CENTRIFUGO_TOKEN_HMAC_SECRET=dev-secret
CENTRIFUGO_API_KEY=dev-api-key
CENTRIFUGO_HTTP_API_URL=http://127.0.0.1:8000/api
NEXT_PUBLIC_CENTRIFUGO_WS_URL=ws://localhost:8000/connection/websocket
```

> macOS Docker Desktop 은 `host.docker.internal` 가 기본 지원되어 subscribe proxy 가 `localhost:3000` 의 `pnpm dev` 앱에 바로 닿는다. env 가 미설정이면 앱은 publish 를 no-op 으로 안전하게 건너뛴다(테스트/오프라인 모드) — 채팅 영속은 동작하고 라이브 fanout 만 비활성.

## 이메일 큐 주기 flush (outbox cron)

앱은 액션 커밋 직후 outbox 를 즉시 flush(`after()` post-commit)한다. 하지만 채팅 알림 메일은 폭주 방지를 위해 윈도우가 끝나는 미래 시각으로 **지연 예약**(scheduled_at)되며, 그 시점엔 보통 어떤 액션도 돌고 있지 않다 → post-commit flush 가 그 행을 집어 보낼 수 없다. 그래서 **매 1분 crontab** 이 `POST /api/cron/flush-outbox` 를 쳐서 (1) 일반 pending 메일과 (2) due 가 된 chat 다이제스트를 비운다. 라우트는 발송 시점에 본문을 재계산하므로 그 사이 수신자가 온라인이 되거나 다 읽었으면 발송을 취소한다.

### 일괄 발송(batch) + rate-limit 회피

Resend 기본 한도는 **초당 2요청**이라 한 RFP 초대(PG 여러 곳 × 담당자)나 입찰 도착 fan-out 이 메일을 건당 연속 발사하면 다수가 429 로 실패했다. 일반 outbox flush 는 이제 청구한 행 전체를 Resend **batch.send**(콜당 최대 100통, rate-limit 상 **1요청**)로 묶어 보낸다 → N통 fan-out 이 ceil(N/100) 콜로 줄어든다. 실패 행은 일시 오류(429/5xx/네트워크)면 **지수 백오프**로 재예약·재시도하고, 영구 오류(잘못된 주소·미인증 발신 도메인·검증 실패)면 즉시 `failed` 로 종결한다(잔여 시도 낭비 방지). 코알레스되는 chat/team 다이제스트는 발송 시 본문을 재계산해야 해 단건 발송을 유지하되 동일한 백오프/분류를 적용한다.

튜닝 env(전부 선택, 기본값 안전): `EMAIL_BATCH_SIZE`(기본 100, 100 상한) · `EMAIL_BATCH_INTERVAL_MS`(기본 600 — 한 flush 내 배치 콜 사이 간격) · `EMAIL_RETRY_BASE_MS`(기본 30000) · `EMAIL_RETRY_CAP_MS`(기본 1800000). 별도 워커 프로세스는 불필요 — 기존 post-commit + 1분 cron 토폴로지 그대로다. 추가 헤드룸이 필요하면 Resend 대시보드에서 rate-limit 상향을 요청하면 된다.

> **메일 실패는 인앱 알림에 영향 없음.** 도메인 이벤트는 인앱 알림 행과 outbox 메일 행을 같은 트랜잭션에서 함께 커밋하고, 발송 실패 처리(`markResult`)는 `outbox_entries` 만 갱신한다 → 메일이 끝내 실패해도 사용자의 인앱 알림·읽음 상태는 그대로 유지된다(회귀 테스트 `email-failure-decoupling.test.ts` 로 고정).

crontab 에 1분 주기로 등록 (`crontab -e`). 시크릿은 **crontab 상단에 한 줄로 정의**해야 cron 이 명령 환경으로 export 하고 안쪽 셸이 이를 펼친다. `flock -n` 로 감싸 **이전 tick 의 flush 가 아직 안 끝났으면 이번 tick 은 건너뛴다** — chat/team 다이제스트 처리기는 lease 없이 due 행을 읽으므로, 1분 안에 안 끝나는 대량 drain 이 다음 cron 과 겹치면 같은 다이제스트가 두 번 발송될 수 있다(일반 flush 는 SKIP-LOCKED+lease 로 안전):

```cron
CRON_SECRET=붙여넣을-시크릿
* * * * * flock -n /tmp/flush-outbox.lock curl -fsS -XPOST localhost:3000/api/cron/flush-outbox -H "x-cron-secret: $CRON_SECRET" >/dev/null 2>&1
```

> **주의 — cron 은 셸 프로필도 `.env.production` 도 읽지 않는다.** 시크릿은 위처럼 **crontab 상단 한 줄**(또는 `/etc/cron.d/` 파일 상단의 `CRON_SECRET=...`)로 정의한다. ⚠️ `* * * * * CRON_SECRET=… curl … -H "x-cron-secret: $CRON_SECRET"` 처럼 **명령 줄 앞에 인라인 대입**하는 형태는 동작하지 않는다 — POSIX 셸은 대입을 적용하기 *전에* `$CRON_SECRET` 를 (아직 비어 있는) 현재 환경으로 펼치므로 빈 헤더가 간다. 빈 값이면 라우트가 fail-closed 로 401 → **메일이 조용히 안 나간다**(우회는 안 되지만 flush 도 안 됨). 정 인라인 대입이 싫고 변수도 안 쓰고 싶으면 헤더에 시크릿 리터럴을 직접 박아도 된다(시크릿은 어차피 같은 호스트 `.env.production` 에 있다). 값은 `.env.production` 의 `CRON_SECRET` 와 **동일**해야 하고, 헤더 이름은 `x-cron-secret` 로 라우트와 정확히 일치시킬 것.

## 전자서명 웹훅 (SnowSign webhook)

스노우싸인(SnowSign)은 진행 이벤트(`contract.sent`·`contract.viewed`·`participant.signed`·`participant.declined`·`contract.completed`·`contract.cancelled`·`contract.expired`)를 등록 URL 로 POST 하는 **웹훅**을 제공한다. 앱은 웹훅을 **상태 소스가 아니라 저지연 폴링 트리거**로 쓴다 — `POST /api/signing/webhook` 가 HMAC-SHA256 서명(`X-Webhook-Signature`)을 검증한 뒤 payload 의 `contract_id`(=우리 `provider_ref`)만 뽑아 `reconcileByProviderRef` → `reconcileStatus`(getContract 재조회)로 위임한다. 상태 매핑이 폴링과 동일한 단일 경로를 타므로 payload 본문을 신뢰할 필요가 없고, 멱등 `ensureFinalized` 로 웹훅·폴링 중복이 무해하다.

**설정**: SnowSign 웹 콘솔 → 조직 설정 → 웹훅 → 새 웹훅에 URL `https://partner.support-b.com/api/signing/webhook` + 구독 이벤트(최소 `contract.completed`·`contract.cancelled`, 권장 전부)를 등록하고, 발급된 **시크릿 키를 `.env.production` 의 `SNOWSIGN_WEBHOOK_SECRET`** 에 넣는다. 미설정이면 라우트가 fail-closed 로 401(웹훅 무시) → 폴링만으로 동작(아래). 크론과 달리 별도 crontab 은 필요 없다(SnowSign 이 push).

> **웹훅은 auto-retry 가 없다**(전달 실패 시 콘솔에서 수동 재전송만 가능). 그래서 아래 폴링을 **백스톱**으로 항상 함께 켠다 — 웹훅이 유실돼도 완료/거절/만료가 늦어도 2분 안에 반영된다.

## 운영자 슬랙 알림 (operator Slack alerts)

두 종류의 알림이 운영자 슬랙 채널로 나간다(best-effort, 커밋 후 fire-and-forget — 실패해도 기능 무영향).

1. **전자서명 라이프사이클 전이** — 계약 대기 생성·발송·연결·완료·거절/만료·지연·취소.
2. **신규 가입·PG사 계정 합류 심사 요청** — 기존 `ADMIN_NOTIFY_EMAIL` 메일과 **병행**해서 나간다(메일이 감사 기록을 겸하므로 끊지 않는다). 두 채널은 서로 독립이라 한쪽이 실패해도 다른 쪽은 나간다.

**설정**: [api.slack.com/apps](https://api.slack.com/apps) → `Create New App` (From scratch) → 워크스페이스 선택 → 좌측 `Incoming Webhooks` → 토글 **On** → `Add New Webhook to Workspace` → 알림 받을 채널 선택 → 발급된 `https://hooks.slack.com/services/T…/B…/…` 복사 → `.env.production` 의 `SLACK_WEBHOOK_URL` 에 붙여넣고 `pm2 restart supporter-b`. 런타임 변수라 **재빌드는 필요 없다**. 미설정이면 발송만 생략된다(fail-open).

별도 crontab 은 필요 없다 — 상태 전이 지점에서 직접 발화하므로 폴링·웹훅이 no-op 인 틱에는 나가지 않는다.

**관측 위치가 두 곳으로 갈린다:**
- **설정 오류·장애**(403 `invalid_token`, 404 `no_service`, 5xx 등) → Sentry(`context: 'slack'`). 상태코드와 함께 슬랙이 돌려준 평문 본문이 실린다 — 웹훅이 폐기된 것인지 슬랙 장애인지는 그 본문으로만 구분된다.
- **429 레이트 리밋** → **Sentry 가 아니라 Axiom 로그**(`slack.rate_limited`). 예상된 결과라 예외로 올리지 않는다(아래 참조). Sentry 에서 `http_429` 를 찾으면 나오지 않으니, 배치 알림이 밀렸는지는 이 로그로 본다.

**메시지에는 견적번호·제목·이벤트·회차만 담기고 금액·수수료는 절대 포함되지 않는다**(봉인 입찰 경계). 가입 알림에는 워크스페이스명·가입자명·심사 링크가 담긴다.

> **웹훅 URL 은 채널 하나에 묶인다.** 계약 알림과 가입 알림이 같은 채널에 모인다 — 나중에 나누려면 두 번째 환경변수를 추가하는 것이지 이 값을 재설정하는 게 아니다.

> **레이트 리밋 1건/초**(짧은 버스트는 허용). `notifyStaleSent` 는 cron 틱 하나에서 최대 50건까지 쏘므로 방치된 계약이 많이 쌓인 날에는 일부가 429 로 떨어질 수 있다. **의도적으로 큐·재시도를 만들지 않았다** — best-effort 알림이고 인앱 알림·감사 로그가 durable record 이기 때문이다. 429 는 Sentry 가 아니라 Axiom 로그(`slack.rate_limited`)에 남는다 — 예상된 결과라 예외로 올리지 않는다(Sentry 기본 통합에 dedupe 가 없어 틱당 수십 개의 개별 이벤트가 되기 때문).

## 전자서명 상태 폴링 (poll-signing-status cron)

위 웹훅이 저지연으로 상태를 밀어주지만 auto-retry 가 없어 유실될 수 있으므로, 진행 중(sent/in_progress) 전자서명 계약의 상태(열람·서명·완료·거절·만료)를 **폴링**으로도 동기화해 백스톱을 둔다. 딜룸 진입 시 lazy reconcile(`last_polled_at` throttle)도 있지만, 아무도 딜룸을 안 열어도 완료/거절/만료가 반영되고 완료 알림이 나가도록 crontab 이 주기적으로 `POST /api/cron/poll-signing-status` 를 친다(오래 안 본 순 배치, 429 백오프, stuck 복구, 멱등 `ensureFinalized`). flush-outbox 와 **동일한 `CRON_SECRET`/`x-cron-secret` 규약**(위 crontab 상단 한 줄을 공유 — 시크릿은 헤더 전용·상수시간 비교, 쿼리 파라미터 미지원). 같은 호출이 방치된 `awaiting_pg_template` 계약(PG 가 계약서를 올려 보내지 않은 채 오래 멈춘 딜)도 7일 스로틀로 PG 에게 재넛지한다. 서명은 분 단위 긴박함이 없어 2분 주기로 충분하다.

```cron
# (위 CRON_SECRET 정의를 공유 — 같은 crontab 상단 한 줄이면 된다)
*/2 * * * * flock -n /tmp/poll-signing.lock curl -fsS --max-time 90 -XPOST localhost:3000/api/cron/poll-signing-status -H "x-cron-secret: $CRON_SECRET" >/dev/null 2>&1
```

> **전제: `.env.production` 에 `SNOWSIGN_API_KEY` 를 설정**해야 폴링이 SnowSign 을 호출해 상태를 움직인다(미설정이면 서비스가 에러를 삼켜 `last_polled_at` 만 갱신되고 상태는 정체). `flock` 은 이전 tick 이 안 끝났을 때 겹침을 막는다.
>
> ⚠️ **`--max-time` 이 없으면 락이 영구히 물릴 수 있다 (v0.5.3.0 추가).** 이 틱은 보관함
> 하이드레이션에서 R2 로 최대 30MB 를 PUT 하는데, S3 클라이언트에 요청 타임아웃 설정이
> 없다. 공급자·fetch 는 각각 15초 데드라인이 있지만 그 PUT 은 없어서, 한 번 매달리면
> `flock -n` 이 잡은 락이 풀리지 않고 **이후 모든 틱이 조용히 건너뛰어진다** — reconcile·
> 재넛지·유실 스윕·방치 알림·하이드레이션이 한꺼번에 멎고 웹훅만 남는다. `--max-time` 은
> curl 을 끊어 락을 돌려주므로 다음 틱이 스스로 회복한다. (S3 클라이언트 자체의 타임아웃은
> 첨부 업로드까지 영향 범위가 넓어 별건으로 TODOS.md 에 등재했다.)

## 채팅 활성화 — 기존 운영 서버 마이그레이션 체크리스트

`feat+realtime-chat` 이 `main` 에 처음 머지·배포될 때 한 번만 필요한 추가 작업. 일반 `lightsail-deploy.sh` 단독으로는 부족하다 — Centrifugo 시크릿, DB 스키마 4개 신규 테이블, Caddyfile `/connection/*` 라우트, crontab 이 모두 새로 생겼기 때문.

### 선행: 로컬에서 dev → main PR 머지

```bash
# /ship 스킬 또는 gh pr create
```

### 1. 서버 — `.env.production` 에 신규 변수 추가

> **⚠️ 반드시 deploy 스크립트 실행 전에 완료** — `NEXT_PUBLIC_CENTRIFUGO_WS_URL` 은 빌드 타임 인라인이라 값이 없으면 WS 연결이 안 됨. `CENTRIFUGO_TOKEN_HMAC_SECRET` / `CENTRIFUGO_API_KEY` 누락 시 `docker compose up` 이 `:?` 오류로 실패.

```bash
# 서버에서 강한 시크릿 생성
CENTRIFUGO_TOKEN_HMAC_SECRET=$(openssl rand -base64 48)
CENTRIFUGO_API_KEY=$(openssl rand -base64 48)
CRON_SECRET=$(openssl rand -base64 32)

# .env.production 에 추가 (값 채워 넣기)
CENTRIFUGO_TOKEN_HMAC_SECRET=<위에서 생성>
CENTRIFUGO_API_KEY=<위에서 생성>
CENTRIFUGO_HTTP_API_URL=http://127.0.0.1:8000/api
NEXT_PUBLIC_CENTRIFUGO_WS_URL=wss://support-b.com/connection/websocket
CRON_SECRET=<위에서 생성>
```

### 2. 서버 — DB 스키마 push (deploy 전, pm2 reload 전)

git pull 로 새 스키마 코드를 받기 전에도 아래처럼 배포 직전 수동으로 실행하거나, git pull 후 deploy 스크립트 내 빌드 단계 전에 별도 실행한다.

```bash
set -a; . ./.env.production; set +a
pnpm db:push
```

아래 변경이 모두 **additive** (데이터 손실 없음) — 전부 Yes:

| 변경 | 타입 |
|---|---|
| `chat_conversations` 테이블 신규 | 추가 |
| `chat_messages` 테이블 신규 | 추가 |
| `chat_conversation_reads` 테이블 신규 | 추가 |
| `chat_message_templates` 테이블 신규 | 추가 |
| `attachments.chat_message_id` nullable 컬럼 + 인덱스 추가 | 추가 |
| `attachments` CHECK 제약 교체 (`chat_message_id` 포함으로 완화) | DROP+ADD; 기존 데이터는 `NULL` → 제약 통과 |
| `outbox_event` 열거형에 `'chat.message'` 추가 | 추가 |

### 3. 서버 — deploy 스크립트 실행

```bash
bash scripts/deploy/lightsail-deploy.sh
```

스크립트 내부에서 자동 처리:
- `git pull`
- `docker compose -f docker-compose.prod.yml up -d` → **pg + Centrifugo 컨테이너 동시 기동** (Centrifugo 는 이 배포에서 최초 기동)
- `NEXT_PUBLIC_CENTRIFUGO_WS_URL` 인라인 포함 `next build`
- `pm2 reload`

### 4. 서버 — Caddyfile 업데이트 + 리로드

운영 서버의 `/etc/caddy/Caddyfile` 은 채팅 추가 이전 버전이라 `/connection/*` → 8000 라우트가 없다. `git pull` 로 받은 레포 버전으로 교체:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

추가된 블록:
```
handle /connection/* {
    reverse_proxy 127.0.0.1:8000   # WebSocket → Centrifugo
}
```

### 5. 서버 — crontab 등록 (chat 다이제스트 이메일)

```bash
crontab -e
```

```cron
CRON_SECRET=<.env.production 의 CRON_SECRET 와 동일한 값>
* * * * * flock -n /tmp/flush-outbox.lock curl -fsS -XPOST localhost:3000/api/cron/flush-outbox -H "x-cron-secret: $CRON_SECRET" >/dev/null 2>&1
```

> `CRON_SECRET=` 는 **명령줄 앞 인라인이 아닌 상단 한 줄**로 정의. 인라인 방식은 빈 값으로 펼쳐져 401이 됨 — §이메일 큐 주기 flush 참조.

### 6. 검증

```bash
# Centrifugo 정상 기동 확인
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs centrifugo

# 브라우저 DevTools → Network → WS 탭 → /connection/websocket 101 Switching Protocols 확인
# 채팅 메시지 전송 후 새로고침 없이 상대방 화면에 즉시 수신되는지 확인
```

문제 발생 시 §트러블슈팅의 "채팅 메시지가 실시간으로 안 옴" 항목 참조.

## 첨부파일 저장소 전환 (Postgres bytea → Cloudflare R2)

첨부파일 바이트는 더 이상 Postgres `attachment_blobs` 테이블에 저장되지 않고 Cloudflare R2(S3 호환 API, `lib/server/storage/r2.ts`)로 이전됐다. 업로드는 **presigned PUT 직행**(브라우저 → R2, 서버는 발급/검증만 — `POST /api/files/presign` → PUT → `POST /api/files/{id}/complete`), 다운로드는 `GET /api/files/{id}` 가 ACL 검증 후 **302 → presigned GET URL**(TTL 15분)로 넘긴다 — 파일 바이트가 VM 을 지나지 않는다. `feat+r2-attachment-storage` 가 처음 배포될 때 한 번만 필요한 작업이다.

### 1. Cloudflare 대시보드 — R2 버킷 + API 토큰 발급 + CORS

1. Cloudflare 대시보드 → R2 → **Create bucket** (버킷명 예: `supporter-b-attachments`).
2. R2 → **Manage API tokens** → **Create API token**, 권한 **Object Read & Write**(해당 버킷 스코프)로 발급 → Access Key ID / Secret Access Key 확보.
3. 계정 ID 확인: R2 개요 페이지 우측 또는 대시보드 URL 에 노출된 Account ID.
4. **버킷 CORS 설정 (presigned PUT 직행 업로드에 필수)**: 버킷 → Settings → CORS policy 에 아래를 등록한다. 이게 없으면 브라우저의 R2 직행 PUT 이 CORS preflight 에서 전부 실패한다(업로드가 "업로드 실패"로만 보임).

```json
[
  {
    "AllowedOrigins": ["https://support-b.com", "https://partner.support-b.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

로컬 dev 전용 버킷에는 `"AllowedOrigins": ["http://localhost:3000"]` 로 동일하게 등록한다. 다운로드(presigned GET)는 302 내비게이션/iframe 로드라 CORS 불필요.

### 2. 서버 — `.env.production` 에 R2 변수 4종 추가

```bash
R2_ACCOUNT_ID=<위에서 확인한 계정 ID>
R2_ACCESS_KEY_ID=<발급받은 Access Key ID>
R2_SECRET_ACCESS_KEY=<발급받은 Secret Access Key>
R2_BUCKET=supporter-b-attachments
```

4개 모두 채워야 한다 — 하나라도 비면 `getStorage()` 가 **모든 환경에서** throw 하며 첨부파일 관련 라우트가 전부 fail-fast 에러를 낸다. 폴백 백엔드는 의도적으로 없다 — 로컬 dev도 동일하게 R2 env 가 필요하니, 로컬에서 작업하는 개발자는 같은 4개 변수를 `.env` 에 넣어 두면 된다(단위 테스트는 `__setStorageForTest` 로 mock 을 주입하므로 영향 없음).

```bash
pm2 reload bidit
```

### 2-b. crontab — 버려진 pending 업로드 청소 (sweep-uploads)

presigned 2-phase 업로드는 presign 발급 후 PUT/complete 에 도달하지 못한 `status='pending'` row 를 구조적으로 남긴다. 브라우저는 `pending/<최종키>` staging 객체에 PUT 하고, 서버가 ETag 조건부 복사로 검증된 바이트만 최종 키에 승격한다. 1시간 초과 pending row(+ staging·레거시 최종키 객체)는 `POST /api/cron/sweep-uploads` 가 청소한다 — flush-outbox 와 같은 `CRON_SECRET` 게이트(fail-closed). crontab 에 한 줄 추가(시간당 1회면 충분):

배포 전에 같은 버킷에 R2 lifecycle 규칙도 반드시 추가한다. complete 뒤에도 10분짜리 PUT URL을 재사용하면 DB row 없이 staging 객체만 다시 생겨 앱 sweeper가 찾지 못하기 때문이다. Cloudflare 대시보드의 R2 → `supporter-b-attachments` → Settings → Object lifecycle rules에서 다음 규칙을 만든다.

- 이름: `expire-presigned-upload-staging`
- Prefix: `attachments/pending/`
- Action: uploaded object expiration
- 기간: 1 day

이 규칙은 고아 staging 객체의 최종 안전망이고, 정상 complete와 아래 cron의 즉시·1시간 청소를 대신하지 않는다. prefix를 `attachments/`로 넓히면 ready 첨부파일까지 삭제되므로 정확히 일치시킨다.

```cron
17 * * * * flock -n /tmp/sweep-uploads.lock curl -fsS -XPOST localhost:3000/api/cron/sweep-uploads -H "x-cron-secret: $CRON_SECRET" >/dev/null 2>&1
```

(`CRON_SECRET` 정의 방식·인라인 대입 함정은 위 flush-outbox 절의 주의 사항과 동일.)

### 3. 전환 1회 데이터 정리 — 기존 bytea 첨부 폐기

기존 Postgres bytea 첨부 데이터는 R2 로 마이그레이션하지 않고 **폐기하기로 결정**했다. 배포 전 서버에서 1회 수동 실행:

```bash
docker compose -f docker-compose.prod.yml exec pg psql -U supporter_b -c 'TRUNCATE attachments CASCADE;'
```

이어서 더 이상 쓰지 않는 `attachment_blobs` 테이블 제거는 `drizzle-kit push`(대화형, **`--force` 금지**)로 수행한다:

```bash
set -a; . ./.env.production; set +a
pnpm db:push
```

표시되는 변경 statement가 **아래 3종(첨부 R2 전환분)뿐인지 확인한 뒤에만 승인**한다: ① `DROP TABLE attachment_blobs` ② `attachments` 에 `status` 컬럼 추가(+ `attachments_status_check` CHECK) ③ `attachments_pending_idx` 부분 인덱스 생성. 예상 밖의 DROP/ALTER 가 함께 보이면 승인하지 말고 중단한 뒤, 수동으로 아래만 실행한다:

```sql
DROP TABLE attachment_blobs;
ALTER TABLE attachments ADD COLUMN status text NOT NULL DEFAULT 'ready';
ALTER TABLE attachments ADD CONSTRAINT attachments_status_check CHECK (status IN ('pending','ready'));
CREATE INDEX attachments_pending_idx ON attachments (uploaded_at) WHERE status = 'pending';
```

### 4. 검증

- R2 env 4종이 모두 채워진 상태에서 앱이 정상 기동하는지(`pm2 logs bidit` 에 `getStorage()` 관련 에러 없음).
- 첨부파일 업로드가 정상 동작하는지(브라우저 devtools Network 에서 R2 도메인으로의 직행 PUT 200 → complete 200 — CORS 미설정이면 여기서 실패).
- 다운로드/미리보기: `GET /api/files/{id}` 가 302 로 R2 presigned URL 에 넘기고 PDF iframe 이 뜨는지.
- R2 대시보드에서 완료 전에는 `attachments/pending/<id>`, 완료 후에는 `attachments/<id>` 키가 남는지 확인.
- sweep-uploads cron 등록 후 `curl -XPOST localhost:3000/api/cron/sweep-uploads -H "x-cron-secret: $CRON_SECRET"` 가 `{"deletedRows":0,...}` 형태로 응답하는지.

## partner.support-b.com 서브도메인 (PG 호스트 라우팅) 롤아웃

`partner.support-b.com` 은 **별도 프로세스 없이** 동일한 `:3000` Next.js 앱이 서빙한다. PM2 앱을 새로 띄우지 않아도 된다 — Caddy 가 두 호스트를 한 블록에서 처리한다.

### 1. DNS — deploy 전에 선행 필수

도메인 DNS 에 A 레코드를 추가한다:

```
partner.support-b.com  A  <Lightsail 고정 IP>
```

> **⚠️ Caddy 리로드 전에 레코드가 전파돼 있어야 한다.** Caddy 는 호스트별로 Let's Encrypt ACME 챌린지를 시도하므로, `dig +short partner.support-b.com` 이 고정 IP 를 반환하는 것을 확인한 뒤 Caddy 를 리로드할 것.

### 2. `.env.production` 에 신규 변수 추가

> **⚠️ `NEXT_PUBLIC_*` 는 빌드 타임 인라인** — 값 변경 후 `pnpm build` 없이 `pm2 reload` 만 해서는 반영 안 됨. `AUTH_COOKIE_DOMAIN` 은 런타임 변수라 restart 만으로 충분.
>
> **⚠️ `AUTH_COOKIE_DOMAIN` 설정은 기존 사용자 전원을 1회 로그아웃** 시킨다. Caddy 리로드·DNS 컷오버와 같은 시점에 진행할 것.
>
> **⚠️ 두 오리진은 반드시 함께 설정하거나 둘 다 비운다 (v0.4.3.0~).** 하나만 설정하면 `appOrigins()`(`lib/site-routing.ts`)가 **예외를 던진다**. 예전에는 나머지가 폴백으로 채워지며 "단일 호스트 dev" 와 구별되지 않았고, 그 상태에서 partner 호스트의 비색인(`robots.txt` + `X-Robots-Tag`)과 `/login/ops` 의 OAuth PKCE 호스트 핀이 **동시에 조용히 꺼졌다**. 이제는 그런 반쪽 설정이 배포 즉시 드러난다.

```bash
# 런타임 변수 (restart 로 반영)
AUTH_COOKIE_DOMAIN=.support-b.com

# 빌드 타임 변수 (변경 후 반드시 pnpm build 재실행)
# — 아래 둘은 both-or-neither. 한 줄만 남기면 앱이 부팅 시 throw 한다.
NEXT_PUBLIC_BUYER_ORIGIN=https://support-b.com
NEXT_PUBLIC_PARTNER_ORIGIN=https://partner.support-b.com
```

### 3. Caddyfile 교체 + 리로드

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`git pull` 로 받은 `deploy/Caddyfile` 은 메인 블록 주소가 `{$APP_DOMAIN}, partner.{$APP_DOMAIN}` 로 바뀌어 있다. `admin.{$APP_DOMAIN}` 블록은 그대로다.

> ⚠️ 호스트 라우팅은 Caddy 가 업스트림으로 원본 `Host` 헤더를 그대로 전달하는 데 의존한다(Caddy v2 `reverse_proxy` 기본 동작). `header_up Host {upstream_hostport}` 같은 설정을 추가하면 앱이 `127.0.0.1:3000` 을 호스트로 보게 되어 라우팅이 조용히 멈춘다(에러 없이 리다이렉트 안 됨). 기본 동작을 유지할 것.

### 4. 배포 (빌드 포함)

```bash
bash scripts/deploy/lightsail-deploy.sh
```

`NEXT_PUBLIC_BUYER_ORIGIN` / `NEXT_PUBLIC_PARTNER_ORIGIN` 이 **둘 다** `.env.production` 에 설정된 상태에서 빌드돼야 한다. 하나만 설정된 채로 배포하면 `appOrigins()` 가 throw 하며 앱이 뜨지 않는다 — 롤백은 두 줄을 모두 채우거나 모두 지운 뒤 재빌드다(둘 다 비우면 호스트 라우팅이 꺼진 단일 호스트 모드로 정상 동작).

### 5. 수동 확인 체크리스트

배포 후 아래를 직접 확인한다:

- [ ] PG 계정으로 `support-b.com/home` 접속 → `partner.support-b.com/home` 으로 307 리다이렉트되고 로그인 유지
- [ ] 두 워크스페이스를 가진 유저가 워크스페이스 전환 시 서브도메인 간 이동 후 로그인 유지
- [ ] `support-b.com` / `partner.support-b.com` 양쪽에서 채팅 실시간 수신 정상 동작
- [ ] RFP 초대 이메일의 링크가 `partner.support-b.com` 도메인을 가리킴

## 운영자 알림 디스코드 → 슬랙 컷오버 (v0.5.4.0)

운영자 웹훅 알림이 디스코드에서 슬랙으로 **교체**됐다. 디스코드 경로는 코드에서 완전히 제거됐으므로, `DISCORD_WEBHOOK_URL` 만 남겨 두면 **알림이 통째로 끊긴다**(앱은 정상 동작하지만 운영 채널이 조용해진다).

### 1. 슬랙 웹훅 발급

[api.slack.com/apps](https://api.slack.com/apps) → `Create New App` (From scratch) → 워크스페이스 선택 → `Incoming Webhooks` 토글 **On** → `Add New Webhook to Workspace` → 채널 선택 → URL 복사.

### 2. 서버 — `.env.production` 교체

```bash
# 삭제
DISCORD_WEBHOOK_URL=...

# 추가 (런타임 변수 — 재빌드 불필요)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T…/B…/…
```

```bash
pm2 restart supporter-b
```

### 3. 확인

- [ ] 슬랙 채널에 테스트 계약 전이 1건이 도착한다(견적번호·제목·이벤트만, 금액 없음)
- [ ] 신규 가입 심사 요청이 **슬랙과 이메일 양쪽**에 도착한다 (v0.5.4.0 신규)
- [ ] Sentry 에 `context: 'slack'` 이벤트가 쌓이지 않는다

> 롤백은 `git revert` 다 — 디스코드 전송 모듈이 삭제됐으므로 환경변수만 되돌려서는 복구되지 않는다.

## Node 설치 (Amazon Linux 2023)

AL2023 은 glibc 2.34 라 **공식 Node 22 바이너리가 그대로 실행된다** (AL2의 `GLIBC_2.28 not found` 문제 없음). bootstrap 은 nodejs.org 공식 `linux-x64` tarball 을 `/usr/local` 에 설치한다.

- 버전 변경: `NODE_VERSION=22.x.x bash scripts/deploy/lightsail-bootstrap.sh`
- 참고: AL2023 기본 저장소의 `nodejs20` 패키지는 Node 20 이라 쓰지 않는다 (이 앱은 Node 22 기준).
- 만약 인스턴스를 구형 **Amazon Linux 2**(glibc 2.26)로 만들었다면 공식 바이너리는 실행 안 되니, AL2023 으로 재생성하거나 bootstrap §3 을 nodejs.org **비공식 `glibc-217` 빌드** URL 로 바꿔야 한다.

## 트러블슈팅

- **사이트 안 뜸 / TLS 안 됨**: 콘솔 방화벽 443 열렸는지(가장 흔함), `dig` 가 고정 IP 가리키는지, `journalctl -u caddy` 의 ACME 에러 확인.
- **`node` 못 찾음 / 버전 이상**: `which node`(=`/usr/local/bin/node`), `node -v`(v22) 확인. AL2023 이 아니라 구형 AL2 면 `GLIBC_2.28 not found` 가 날 수 있다 → §Node 설치.
- **빌드 중 OOM/멈춤**: `swapon --show` 로 swap 확인. `NODE_BUILD_HEAP_MB=1280 bash scripts/deploy/lightsail-deploy.sh` 로 더 낮춰 재시도.
- **`lightsail-deploy.sh` 가 git 단계에서 인증 실패** (`Permission denied (publickey)` / `could not read Username`): 레포가 private 이라 deploy key 가 반드시 있어야 한다. 순서대로 확인 — ① `git remote -v` 가 `git@github-supporterb:...` 인지(HTTPS 면 §기존 서버를 HTTPS → SSH 로 옮기기), ② `ssh -T git@github-supporterb` 가 `Hi bothsides-platform-dev/supporter-b!` 로 응답하는지, ③ `gh repo deploy-key list -R bothsides-platform-dev/supporter-b` 에 키가 살아 있는지, ④ `~/.ssh/config` 의 별칭 블록에 `IdentitiesOnly yes` 가 있는지(없으면 ssh-agent 의 다른 키가 먼저 제시돼 거부된다), ⑤ `ssh-keygen -F github.com` 으로 known_hosts 항목이 있는지(BatchMode 라 대화식 수락이 불가능해 없으면 실패한다).
- **`docker: permission denied`**: bootstrap 후 재접속(또는 `newgrp docker`)으로 docker 그룹 반영.
- **DB 접속 실패**: `DATABASE_URL` 의 자격증명이 `.env.production` 의 `POSTGRES_*` 와 일치하는지, 컨테이너가 떴는지(`docker compose -f docker-compose.prod.yml ps`) 확인.
- **배포 직후 앱이 안 뜸 + 로그에 `NEXT_PUBLIC_..._ORIGIN is set but ... is not`**: 두 오리진 중 하나만 `.env.production` 에 남은 상태다. `appOrigins()` 가 의도적으로 throw 한다(v0.4.3.0~) — 반쪽 설정은 partner 호스트 비색인과 `/login/ops` PKCE 호스트 핀을 조용히 함께 꺼뜨리기 때문. 고치는 법: 두 줄을 모두 채우거나 모두 지운 뒤 **재빌드**(`NEXT_PUBLIC_*` 는 빌드 타임 인라인이라 `pm2 reload` 만으론 반영 안 됨).
- **채팅 메시지가 실시간으로 안 옴(새로고침해야 보임)**: (1) `journalctl`/`docker compose logs centrifugo` 에 `namespace not found` 면 config 의 `chat` 네임스페이스 누락 — 채널은 `chat:conversation:<id>` 라 첫 콜론 앞 `chat` 네임스페이스가 정의돼 있어야 한다. (2) 구독이 전부 거부되면 subscribe proxy 가 앱에 못 닿는 것 — `host.docker.internal` 매핑(`extra_hosts: host-gateway`)과 앱이 3000 에 떠 있는지 확인. (3) WS 연결 자체가 안 되면 Caddy `/connection/*` 라우트와 `NEXT_PUBLIC_CENTRIFUGO_WS_URL`(빌드 타임 인라인 — 바뀌면 재빌드) 확인. (4) `allowed_origins` 불일치(브라우저 Origin ≠ `https://<APP_DOMAIN>`)면 연결 거부 — `APP_DOMAIN` 확인.
