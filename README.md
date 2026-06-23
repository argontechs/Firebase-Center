# Firebase Center

A self-hosted **back-office for sending push notifications** across many of your own apps ("Sites"), through two providers — **Firebase Cloud Messaging (FCM)** and **Huawei Push Kit** — from one control panel. It manages encrypted provider credentials, a stored audience of device tokens, and a unified compose-and-send pipeline, plus a programmatic **send API** so your own backends can trigger pushes.

It is **operator-only** (your team logs in — it is not a public SaaS), runs anywhere via **Docker**, and is built to be maintained as a production system.

---

## Table of contents
1. [What you get](#what-you-get)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Quick start (Docker)](#quick-start-docker)
5. [Configuration (.env)](#configuration-env)
6. [Provider setup (FCM & Huawei)](#provider-setup-fcm--huawei)
7. [Using the app](#using-the-app)
8. [Programmatic APIs](#programmatic-apis)
9. [Local development](#local-development)
10. [Database & migrations](#database--migrations)
11. [Backup & restore](#backup--restore)
12. [Deploying to a server](#deploying-to-a-server)
13. [Security notes](#security-notes-read-this)
14. [Project structure](#project-structure)
15. [Further docs](#further-docs)

---

## What you get
- **Sites → Apps → Credentials → Devices** hierarchy (multi-app, per-platform).
- **Encrypted credential vault** (AES-256-GCM) — FCM service-account JSON and Huawei App ID/Secret are write-only and never returned to the browser or logged.
- **FCM + Huawei adapters** with the correct OAuth flows, batching, and error handling.
- **Durable send pipeline** — a job queue + worker with retries, dead-letter, and automatic dead-token cleanup.
- **Bulk import** — device tokens (CSV/JSON) and credentials (CSV manifest + `.json` files).
- **Compose & history UI** + a **programmatic send API** (`POST /api/v1/messages`) authed by per-Site **send keys**.
- **Auth** — hardened login (argon2id, CSRF, rate-limiting), user management, full audit log.
- **Ops** — migrations on boot, backup/restore scripts, cross-OS Docker.

## Architecture
- **One app** (`app` container): **Nuxt 4-style + Nitro** full-stack TypeScript — UI pages, API routes, the credential vault, the provider adapters, and an in-process send worker.
- **PostgreSQL** (`db` container) via **Drizzle ORM**, with a named volume.
- Job queue is **DB-backed** (no Redis). On boot the app waits for Postgres, applies migrations, seeds the first admin, then serves.

```
┌──────────── docker compose up ────────────┐
│  app (Nuxt+Nitro+worker)  ──▶  db (Postgres, named volume)  │
│  secrets via .env / docker secret (NUXT_BO_MASTER_KEY, …)   │
└────────────────────────────────────────────┘
```

## Prerequisites
The target machine only needs **Docker** (Docker Desktop on macOS/Windows, Docker Engine on Linux). For local development you also want **Node 22+** and **pnpm 10+**.

## Quick start (Docker)
```bash
# 1. Configure
cp .env.example .env
#    then edit .env — at minimum set NUXT_BO_MASTER_KEY, NUXT_SESSION_PASSWORD,
#    POSTGRES_PASSWORD, and NUXT_BO_ADMIN_EMAIL / NUXT_BO_ADMIN_PASSWORD (see below).

# 2. Boot the stack (builds the image, starts Postgres, migrates, seeds the admin, serves)
docker compose up -d --build

# 3. Open the app
open http://localhost:3000     # log in with NUXT_BO_ADMIN_EMAIL / NUXT_BO_ADMIN_PASSWORD
```
On first login you are forced to change the seeded admin password.

## Configuration (.env)
All app config is read from environment variables (Nuxt `NUXT_`-prefixed). Copy `.env.example` and fill it in. **Never commit `.env`** (only `.env.example` is tracked).

| Variable | What it is |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Postgres credentials (consumed by the `db` service). |
| `NUXT_DATABASE_URL` | Connection string the app uses, e.g. `postgres://USER:PASS@db:5432/DB` (host `db` inside compose). |
| `NUXT_BO_MASTER_KEY` | **The AES-256-GCM master key** — the single key that decrypts every stored provider secret. Format: `"<version>:<base64-32-bytes>"`, e.g. `1:$(openssl rand -base64 32)`. Multiple comma-separated versions are allowed during rotation. **Back this up separately — see [Security](#security-notes-read-this).** |
| `NUXT_SESSION_PASSWORD` | Session-cookie secret, ≥32 chars: `openssl rand -hex 32`. |
| `NUXT_BO_ADMIN_EMAIL` / `NUXT_BO_ADMIN_PASSWORD` | The first admin, seeded only when the users table is empty. Single-use (forced change on first login). Boot **fails loudly** if the table is empty and these are unset. |

## Provider setup (FCM & Huawei)
Before the app can actually deliver pushes, set these up in the provider consoles (one-time, per app):

**Firebase Cloud Messaging (FCM):**
1. In the Firebase Console → **Project Settings → Service accounts → Generate new private key** — this `.json` is the credential you upload into a Site's App (it is the *server* key, not `google-services.json`).
2. **iOS:** upload an **APNs auth key (`.p8`)** under Project Settings → Cloud Messaging → Apple app config (without it, iOS sends fail with `THIRD_PARTY_AUTH_ERROR`).
3. **Web:** generate the **Web Push (VAPID) key** under the same settings.
> iOS and Android are typically separate Firebase projects → two service-account files → two credentials on the App.

**Huawei Push Kit:**
1. In AppGallery Connect, enable **Push Kit** for the project.
2. Copy the **App ID** and **App Secret** (the App-level pair, under Project settings) into the Site's App. For newer projects, also note the **Project ID** (v2 endpoint).

## Using the app
1. **Create a Site** (e.g. a product/brand you run) → add an **App** under it.
2. **Add credentials** to the App (FCM service-account JSON and/or Huawei App ID/Secret). The app shows readiness (e.g. "APNs key uploaded", "Push Kit enabled"); secrets are write-only.
3. **Get device tokens in** — either bulk-import a CSV/JSON, or have your mobile apps register tokens via the ingest API (below).
4. **Bulk-onboard credentials** for many apps at once via the **credential CSV-manifest import** (CSV + the `.json` files).
5. **Compose & send** — pick App, write the notification, choose the audience (all / specific devices), preview the recipient count per (provider, platform), and Send. Watch **Send history** for sent/failed/invalid/gave-up counts.

## Programmatic APIs
Two key-authenticated endpoints (bearer keys are hashed at rest and shown once on creation):

**Send API** — your backend triggers a push:
```http
POST /api/v1/messages
Authorization: Bearer <send-key>           # issued per Site in the UI
Content-Type: application/json

{ "appId": "<uuid>",
  "target": { "type": "all" },             # or { "type": "tokens", "deviceIds": [...] }
  "notification": { "title": "…", "body": "…" },
  "data": { },                             # optional
  "mode": "notification",                  # or "data"
  "priority": "high" }                     # or "normal"
→ 202 { "campaignId": "…", "jobsCreated": N }
```

**Ingest API** — your apps register device tokens:
```http
POST /api/apps/:id/devices
Authorization: Bearer <ingest-key>         # issued per App in the UI
{ "token": "…", "provider": "fcm", "platform": "android", "external_user_id": "…" }
```

## Local development
```bash
pnpm install
pnpm dev          # Nuxt dev server (needs NUXT_DATABASE_URL etc. in .env)
pnpm test         # full Vitest suite (auto-migrates a test DB on :55432; see below)
pnpm run build    # production build
```
> The test suite expects a Postgres reachable at `postgres://fc:fc@localhost:55432/firebase_center_test`. Spin one up with:
> `docker run -d --name fc-test-db -p 55432:5432 -e POSTGRES_USER=fc -e POSTGRES_PASSWORD=fc -e POSTGRES_DB=firebase_center_test postgres:16.4-bookworm`
> `pnpm test`'s `globalSetup` applies migrations automatically.

## Database & migrations
- Schema lives in `server/db/schema.ts`; migrations in `server/db/migrations/` (Drizzle).
- Generate a migration after a schema change: `pnpm db:generate`. Apply: `pnpm db:migrate`.
- In Docker, migrations are applied **automatically on boot** by the entrypoint (never `drizzle-kit push` against prod).

## Backup & restore
The database holds irreplaceable data (encrypted credentials, audiences, campaign history).
```bash
scripts/backup.sh          # pg_dump → a timestamped .dump (retain off-host)
# restore: see docs/RESTORE.md
```
**A database backup is useless without `NUXT_BO_MASTER_KEY`.** Back the key up **separately** from the dump; restoring requires **both**. Full runbook: [`docs/RESTORE.md`](docs/RESTORE.md).

## Deploying to a server
> **Full runbook:** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — phased setup (deploy now without a domain, then add TLS when the domain is ready), operations, backups, and troubleshooting. `CLAUDE.md` onboards an AI ops agent to it.

1. Copy the repo to the target machine (Docker installed).
2. Create `.env` with production values; **provision `NUXT_BO_MASTER_KEY` out-of-band** (never in git, never only in the volume).
3. `docker compose up -d --build`. The stack self-initializes (migrate → seed → serve) and restarts on reboot (`restart: unless-stopped`).
4. **Put it behind a reverse proxy / VPN / IP allowlist.** It guards decryptable provider secrets and push access — do not expose port 3000 directly to untrusted networks. If you use the send/ingest APIs publicly, terminate TLS and have the proxy overwrite `X-Forwarded-For`.

## Security notes (read this)
- **Operator-only.** Only your team logs in; there is no public sign-up.
- **Secrets are encrypted at rest** and never returned to the client or logged. `.env`, `.env.bak`, and `.env.test` are git-ignored — **only `.env.example` (placeholders) is ever committed.**
- **The master key is the keystone.** If it leaks, treat all stored provider credentials as compromised: rotate it (`POST /api/admin/master-key/rotate`, admin-only) and regenerate the session secret.
- Every send and credential/admin change is written to the **audit log**.

## Project structure
```
app/                  Nuxt UI (pages, layouts, composables, assets/css)
server/
  api/                Nitro API routes (auth, companies, apps, credentials, campaigns, v1/messages, …)
  db/                 Drizzle schema, client, migrations, migrate/seed scripts
  middleware/         auth + CSRF guard (with /api/v1 + ingest exemptions)
  utils/              crypto vault, push adapters (fcm/huawei), queue/worker, ingest/send keys, audit
docker-compose.yml    app + db services
Dockerfile            multi-stage build
entrypoint.sh         wait-for-db → migrate → seed → serve
scripts/              backup.sh, restore.sh, smoke.sh
docs/                 design spec, technical reference, restore runbook
```

## Further docs
- [`docs/superpowers/specs/2026-06-19-firebase-center-design.md`](docs/superpowers/specs/2026-06-19-firebase-center-design.md) — the full design spec.
- [`docs/superpowers/specs/2026-06-19-firebase-center-technical-reference.md`](docs/superpowers/specs/2026-06-19-firebase-center-technical-reference.md) — FCM/Huawei API mechanics (auth, payloads, error handling).
- [`docs/RESTORE.md`](docs/RESTORE.md) — backup/restore runbook.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — full server deployment & operations runbook.
- [`CLAUDE.md`](CLAUDE.md) — onboarding for an operations agent running on the server.
- `DESIGN.md` / `PRODUCT.md` — UI design system and product context.
