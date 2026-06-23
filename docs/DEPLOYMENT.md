# Firebase Center — Server Deployment & Operations Runbook

**Audience:** the operator (human or a Claude Code agent) standing this up on a VPS or ECS instance. Follow the phases in order. Everything is containerized; you do not install Node/pnpm/Postgres on the host.

> If you are an AI agent: read [`../README.md`](../README.md) (what the product is) and [`RESTORE.md`](RESTORE.md) (backup/restore) before acting. Do not improvise around the **Hard rules** in §7. The domain may not exist yet — that is expected; see Phase 1 (no domain) then Phase 2 (domain ready).

---

## 0. What you are running

Two containers via Docker Compose:
- **`app`** — the Nuxt + Nitro application (UI, API, credential vault, FCM/Huawei adapters, in-process send worker). Listens on container port **3000**.
- **`db`** — PostgreSQL 16 with a named volume `db_data` (the only stateful piece).

On boot the `app` entrypoint waits for `db` to be healthy, **applies migrations**, **seeds the first admin** (only if the users table is empty), then serves. Restarts are safe and idempotent.

## 1. Prerequisites (on the host)

- **Docker Engine + Docker Compose v2** (`docker --version`, `docker compose version`).
- **git** (to pull the repo).
- Outbound HTTPS from the host to Google (FCM) and Huawei push endpoints.
- A non-root user in the `docker` group (recommended).

Nothing else. Do not run `npm`/`pnpm`/`psql` on the host.

## 2. Get the code

```bash
git clone <this-repo-url> firebase-center && cd firebase-center
# later updates:  git pull
```

## 3. Generate secrets (never reuse the examples)

```bash
# AES-256-GCM master key — format "<version>:<base64 of 32 bytes>". Version starts at 1.
printf '1:%s\n' "$(openssl rand -base64 32)"     # -> NUXT_BO_MASTER_KEY
openssl rand -hex 32                              # -> NUXT_SESSION_PASSWORD
openssl rand -hex 24                              # -> POSTGRES_PASSWORD
```

**Record the master key in a separate secrets store now** (password manager / cloud secret manager). A database backup is useless without it, and there is no recovery if it is lost. See §6 and `RESTORE.md`.

## 4. Configure `.env`

```bash
cp .env.example .env
```
Edit `.env` and set every value (`.env` is git-ignored — never commit it):

| Variable | Set to |
|---|---|
| `POSTGRES_USER` | e.g. `firebase_center` |
| `POSTGRES_PASSWORD` | the `openssl rand -hex 24` value |
| `POSTGRES_DB` | e.g. `firebase_center` |
| `NUXT_DATABASE_URL` | `postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@db:5432/<POSTGRES_DB>` (host is the literal `db`) |
| `NUXT_BO_MASTER_KEY` | the `1:...` master key |
| `NUXT_SESSION_PASSWORD` | the `openssl rand -hex 32` value |
| `NUXT_BO_ADMIN_EMAIL` / `NUXT_BO_ADMIN_PASSWORD` | the first admin login (strong password; you are forced to change it on first login) |
| `BO_ALLOWED_ORIGINS` | the exact browser origin(s), comma-separated. **This gates every write (CSRF origin check).** Pick per phase below. |

`BO_ALLOWED_ORIGINS` is applied at **runtime** — change it and restart (`docker compose up -d`), no rebuild needed.

---

## Phase 1 — Deploy before the domain exists

You can run and test fully without a public domain. Do **not** expose port 3000 to the internet yet.

1. Set the origin to how you will reach it during setup:
   - **Recommended (private): SSH tunnel.** Leave compose publishing `3000` and reach it from your laptop with `ssh -L 3000:localhost:3000 user@SERVER`. Then set `BO_ALLOWED_ORIGINS=http://localhost:3000`.
   - **Or by server IP** (only on a trusted network): `BO_ALLOWED_ORIGINS=http://SERVER_IP:3000`.
2. Bring it up:
   ```bash
   docker compose up -d --build
   ```
3. Verify:
   ```bash
   docker compose ps                 # both services Up; db healthy
   docker compose logs -f app        # expect: migrations applied -> first-admin seeded -> Listening on 3000
   curl -fsS localhost:3000/healthz  # 200
   ```
4. Open the app (via the tunnel: `http://localhost:3000`), log in with the admin creds, complete the forced password change.

If you used the server IP, **lock port 3000 to your IP** in the cloud security group / firewall until the reverse proxy is in place.

---

## Phase 2 — When the domain is ready

1. Point the domain's DNS A/AAAA record at the server.
2. Put a TLS-terminating **reverse proxy** in front of the app and proxy to `app:3000`. The proxy is what the internet touches; the app container is not exposed directly.

   **Caddy (automatic Let's Encrypt TLS) — simplest:**
   ```
   push.yourdomain.com {
       reverse_proxy 127.0.0.1:3000
       header_up X-Forwarded-For {remote_host}   # OVERWRITE, do not append
   }
   ```
   (Nginx/Traefik/an ALB work too — the requirements are: terminate TLS, forward to 3000, and **overwrite** `X-Forwarded-For` rather than letting clients spoof it.)
3. Update the origin and restart (no rebuild):
   ```bash
   #  in .env:
   BO_ALLOWED_ORIGINS=https://push.yourdomain.com
   docker compose up -d
   ```
4. Stop publishing 3000 publicly: either bind it to localhost only (`ports: ["127.0.0.1:3000:3000"]` in compose) or remove the `ports:` mapping and have the proxy join the compose network. Confirm `https://push.yourdomain.com/healthz` returns 200 and login works over HTTPS.

---

## 5. Day-2 operations

- **Logs:** `docker compose logs -f app` (or `db`).
- **Status / restart:** `docker compose ps`; `docker compose restart app`.
- **Update to a new version:**
  ```bash
  git pull && docker compose up -d --build     # migrations apply automatically on boot
  ```
- **Stop / start:** `docker compose stop` / `docker compose start`. Data persists in the `db_data` volume.

## 6. Backups & restore (do this from day one)

```bash
scripts/backup.sh        # pg_dump of the db -> a timestamped file; copy it OFF the host
```
Schedule it (cron/systemd timer), keep copies off-host, and **store `NUXT_BO_MASTER_KEY` separately from the dumps** — a restore needs **both** the dump and the matching master key. Full procedure: [`RESTORE.md`](RESTORE.md). Test a restore before you rely on it.

To rotate the master key (e.g. if it is ever exposed): log in as an admin and `POST /api/admin/master-key/rotate`; add the new higher version to `NUXT_BO_MASTER_KEY` first (comma-separated, highest version encrypts).

## 7. Hard rules (do not violate)

1. **Never commit `.env` or any secret** — only `.env.example` (placeholders) belongs in git.
2. **The master key is the keystone.** Back it up separately from the DB; if lost, every stored provider credential is unrecoverable; if leaked, treat all credentials as compromised and rotate.
3. **Never expose port 3000 directly to the public internet.** Internet traffic goes through the TLS reverse proxy only.
4. **`BO_ALLOWED_ORIGINS` must equal the exact origin the browser uses** (scheme + host, no trailing slash). A mismatch makes every write return `403 CSRF check failed`.
5. **Operator-only.** There is no public sign-up; you create accounts in the UI.
6. **Migrations apply on boot.** Never run `drizzle-kit push` against the live database.

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Every save/send returns **403 "CSRF check failed"** | `BO_ALLOWED_ORIGINS` does not match the browser origin. Set it exactly (incl. `https://`), `docker compose up -d`. |
| App container **exits on boot** with a seed error | The users table is empty and `NUXT_BO_ADMIN_EMAIL`/`PASSWORD` are unset. Set them in `.env` and restart. |
| App stuck waiting / DB errors | `db` not healthy yet: `docker compose logs db`; ensure the `POSTGRES_*` values match `NUXT_DATABASE_URL`. |
| Pushes fail with credential/auth errors | The app has no real FCM/Huawei credentials yet, or APNs key missing for iOS. Add them per-app in the UI (Credentials). |
| Changed the domain but writes still 403 | You rebuilt instead of restarting, or `.env` not reloaded. `BO_ALLOWED_ORIGINS` is runtime — edit `.env`, `docker compose up -d`. |

## 9. Quick reference

```bash
docker compose up -d --build     # first deploy / update
docker compose logs -f app       # watch logs
curl -fsS localhost:3000/healthz # liveness (200)
scripts/backup.sh                # backup the database
docker compose down              # stop (keeps the db_data volume)
```
