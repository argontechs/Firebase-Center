# CLAUDE.md — Firebase Center (server operations)

You are the operations agent for **Firebase Center** running on this server (VPS/ECS). This file is your onboarding. Firebase Center is a self-hosted back-office that sends push notifications across many of the owner's own apps through **FCM** and **Huawei Push Kit**, with an encrypted credential vault, managed device-token audiences, scheduling, and a programmatic send API. It is **operator-only** and runs entirely in **Docker**.

## Your job
Deploy it, keep it running, back it up, and apply updates. When a domain is provided, put it behind TLS. You are an operator, not a developer here — prefer the documented commands over editing application code.

## Start here (read before acting)
1. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — the step-by-step runbook. **Follow it.** It has Phase 1 (deploy now, no domain) and Phase 2 (when the domain is ready).
2. [`README.md`](README.md) — what the product is and how operators use it.
3. [`docs/RESTORE.md`](docs/RESTORE.md) — backup/restore procedure.

## The setup, in one breath
`git pull` → generate secrets (`openssl`) → fill `.env` from `.env.example` → `docker compose up -d --build` → verify `curl localhost:3000/healthz` → log in with the seeded admin and change the password. Details and the exact variables are in `docs/DEPLOYMENT.md` §3–§4.

## Hard rules (do not violate)
- **Never commit `.env` or any secret.** Only `.env.example` (placeholders) is tracked. `.env`, screenshots, and test artifacts are git-ignored — keep them out of commits.
- **Back up `NUXT_BO_MASTER_KEY` separately from the database.** It decrypts every stored provider credential; lost = unrecoverable, leaked = rotate everything. A DB backup without it is useless.
- **Never expose port 3000 directly to the public internet.** Public traffic goes through a TLS reverse proxy only (Phase 2).
- **`BO_ALLOWED_ORIGINS` must equal the exact browser origin** (e.g. `https://push.yourdomain.com`, no trailing slash) or every write returns `403 CSRF check failed`. It is runtime-configurable: edit `.env`, then `docker compose up -d` (no rebuild).
- **Migrations apply automatically on boot.** Never run `drizzle-kit push` against the live database.
- The domain may not exist yet. That is expected — run Phase 1 and reach the app via an SSH tunnel until the domain is ready.

## Common commands
```bash
docker compose up -d --build      # first deploy / update after `git pull`
docker compose logs -f app        # watch the app
docker compose ps                 # service health
curl -fsS localhost:3000/healthz  # liveness (expect 200)
scripts/backup.sh                 # back up the database (store off-host)
```

## When something is wrong
Check `docs/DEPLOYMENT.md` §8 (Troubleshooting) first — the common cases (403 CSRF, boot/seed failure, db not ready, push credential errors) are covered there. If a step in the runbook does not match reality or you are blocked, stop and report to the owner rather than improvising changes to application code or the database.
