# Firebase Center — Design Spec

**Date:** 2026-06-19
**Status:** Draft for review
**Companion:** [`2026-06-19-firebase-center-technical-reference.md`](./2026-06-19-firebase-center-technical-reference.md) (fact-checked provider mechanics)

---

## 1. Overview

**Firebase Center** is a self-hosted **back-office (BO)** — a private internal admin web app, operated by the owner's team — that acts as a single control panel for sending **push notifications** across many apps and two providers:

- **Firebase Cloud Messaging (FCM)** — Google's push (Android, iOS, web)
- **Huawei Push Kit ("HCM" / HMS Core)** — push for Huawei devices

It centralizes credential management, a stored audience of device tokens (imported in bulk and/or registered by apps), and a unified compose-and-send experience. The operator manages many companies/sites from one place; each company has its own apps, credentials, and audiences, kept isolated.

## 2. Goals & Non-Goals

### Goals
- One BO to **manage push credentials for many apps** across FCM + Huawei.
- **Create a profile per app**, fill in its credentials, and send through one interface — the BO runs each provider's OAuth flow under the hood.
- **Store and manage device tokens** (managed audiences) per app, with **first-class bulk import**.
- **Compose and send** to all devices, a segment, or specific tokens; see delivery results; auto-clean dead tokens.
- Run **everywhere via Docker** (Linux / Windows / macOS), copy to a live PC and `docker compose up`.
- Be a **maintainable production system for ≥ 1 year**.

### Non-Goals (v1 — YAGNI)
- No per-company self-service logins (no public SaaS). Operator-team only.
- No scheduled/recurring sends, A/B testing, or rich analytics dashboards.
- No high-scale infrastructure (Redis/Kafka) — starts small, designed to grow.
- No SMS/email/in-app channels — push only (FCM + Huawei).

## 3. Requirements & Constraints

| # | Constraint | Source |
|---|---|---|
| R1 | Must run in **Docker** | user (hard requirement) |
| R2 | Must run on **any OS** (Linux/Windows/macOS) — deployable to another PC | user |
| R3 | **Multi-tenant**: many companies → each many apps → each its own credentials + devices | user |
| R4 | **Operator-only auth** — the owner's team operates it; no external company logins | user |
| R5 | **Managed audiences** — system remembers all users' devices; send to stored audiences | user |
| R6 | **Bulk data import** is first-class (existing tokens/users brought in) | user |
| R7 | Providers: **FCM + Huawei Push Kit**, each OAuth2 ("2 OAuth") | user |
| R8 | Provider **secrets encrypted at rest**; never returned to client | best practice (ref §6) |
| R9 | Start at **small scale** (≤ ~10k devices) but **no rewrite to scale up** | user + design |

## 4. Domain Model & Terminology

```
Firebase Center (operated by the team)
│
├── Company  "Acme Corp"            ← top-level tenant (label is configurable; rename-safe)
│     ├── App  "Acme Shopper"       ← one App = one credential profile
│     │     ├── Credentials: FCM service-account JSON  +/or  Huawei App ID/Secret
│     │     └── Devices (imported / registered tokens)  ← the audience
│     └── App  "Acme Rider"
│           ├── Credentials
│           └── Devices
├── Company  "Globex"
│     └── App  "Globex Main" → Credentials → Devices
└── … many more companies
```

- **Company** → many **Apps**. Each **App** = one credential profile + its own devices.
- "Company" is the v1 label; it lives in a single i18n/label constant so it can be renamed to *Client / Site / Brand* later **without** a data migration (cosmetic only).
- A **Campaign** = one composed message + a target (all / segment / specific tokens) within an App.
- A **Delivery** = the per-device result of a campaign.

## 5. Architecture

```
┌──────────────────────────── docker compose up ────────────────────────────┐
│                                                                            │
│  ┌──────────────────────────────┐        ┌──────────────────────────────┐ │
│  │ app  (Nuxt 4 + Nitro)        │        │ db  (PostgreSQL)             │ │
│  │  • UI (BO pages)             │ ─────▶ │  • companies/apps/devices    │ │
│  │  • API (Nitro server routes) │        │  • credentials (encrypted)   │ │
│  │  • Provider adapters (FCM,   │        │  • campaigns/deliveries      │ │
│  │    Huawei) behind one iface  │        │  • jobs (DB-backed queue)    │ │
│  │  • Send worker (in-process)  │        │  named volume (portable)     │ │
│  └──────────────────────────────┘        └──────────────────────────────┘ │
│   secrets via .env / docker secret (BO_MASTER_KEY, DB creds)               │
└────────────────────────────────────────────────────────────────────────────┘
   The send worker starts in-process now; splitting it into its own
   container later is a compose change + a different start command — no rewrite.
```

**Components (each one purpose, testable in isolation):**
- **UI** — BO pages: companies, apps, credentials, devices/import, compose/send, history.
- **API (Nitro routes)** — CRUD + import + enqueue-send + token-registration endpoint.
- **Credential vault** — encrypt/decrypt provider secrets (AES-256-GCM); exposes only metadata to callers.
- **Provider adapter layer** — `PushProvider` interface with `FcmAdapter` + `HuaweiAdapter`; mints/caches tokens, renders the neutral message to each wire shape, sends, normalizes errors.
- **Token cache** — in-memory per-app access tokens with proactive refresh (< 5 min before 1h expiry).
- **Send pipeline** — campaign → `jobs` rows → worker → adapters → `deliveries` + token cleanup.
- **Import pipeline** — CSV/JSON upload → validate → upsert devices by token.
- **Auth** — team accounts (email + password, roles), session cookie.

## 6. Data Model (PostgreSQL via Drizzle)

```
users        ( id, email, password_hash, role[admin|operator], created_at )
companies    ( id, name, status, notes, created_at )
apps         ( id, company_id→companies, name, notes, created_at )
app_credentials ( id, app_id→apps, provider[fcm|huawei],
                  secret_ciphertext, secret_nonce, secret_tag, key_version,
                  meta_jsonb,            -- non-secret: project_id / app_id / huawei_project_id / readiness flags
                  configured_at, rotated_at,
                  UNIQUE(app_id, provider) )
devices      ( id, app_id→apps, provider[fcm|huawei], platform[android|ios|huawei|web],
               token, external_user_id, attributes_jsonb, status[active|invalid|unsubscribed],
               created_at, last_seen_at,
               UNIQUE(app_id, token) )          -- provider-scoped identity (ref §2)
imports      ( id, app_id→apps, filename, total_rows, inserted, updated, failed,
               status, created_by→users, created_at )
campaigns    ( id, app_id→apps, title, body, data_jsonb, mode[notification|data],
               target_type[all|segment|tokens|topic], target_value_jsonb,
               provider_scope[both|fcm|huawei], status, created_by→users, created_at )
deliveries   ( id, campaign_id→campaigns, device_id→devices (nullable), provider,
               token, status[queued|sent|failed|invalid], error_code, response_meta,
               sent_at )
jobs         ( id, type, payload_jsonb, status[pending|running|done|failed],
               attempts, run_after, idempotency_key, last_error, created_at )  -- DB-backed queue
audit_log    ( id, user_id→users, action, target_type, target_id, meta_jsonb, created_at )
```

- Per-device `attributes_jsonb` (e.g. `{country, app_version, language}`) powers segmentation via Postgres JSONB indexes.
- Secrets stored as `ciphertext + nonce + tag + key_version` (AES-256-GCM); `meta_jsonb` holds only non-secret display data.

## 7. Provider Adapter Layer

A single interface keeps all vendor differences in one place:

```
interface PushProvider {
  mintToken(credential): Promise<AccessToken>       // cached, proactive refresh
  send(credential, NeutralMessage, recipients[]): Promise<DeliveryResult[]>
  // internally: render NeutralMessage → wire shape, chunk to vendor limits, normalize errors
}
```

- **`FcmAdapter`** — HTTP v1 (`/v1/projects/{project_id}/messages:send`); JWT-from-service-account OAuth2; `sendEach*` fanout (≤ 500, 1 req/token); `data` as flat map.
- **`HuaweiAdapter`** — `client_credentials` OAuth2; v1 (`/v1/{app_id}/...`) **and** v2 (`/v2/{projectId}/...`); native multi-token (≤ 1000); `data` as JSON **string**; must read body `code` (HTTP 200 even on failure).
- **Error normalization** → common dispositions: `DELETE_TOKEN`, `RETRY_BACKOFF`, `FIX_REQUEST`, `REAUTH`, `FIX_CREDENTIALS` (full mapping in reference §5/§8).

## 8. Credential Vault & Security

- **AES-256-GCM**, fresh 12-byte nonce per encryption, store nonce + tag + `key_version`.
- **Master key from env** (`BO_MASTER_KEY`) injected via `.env` / docker secret — pragmatic floor for v1, with a documented path to KMS/envelope encryption.
- **Write-only secret fields:** UI accepts the SA JSON / App Secret on save; reads return only metadata (`configured: true`, `project_id` / App ID, fingerprint). Decrypted secrets never leave the server.
- **Never log** the SA JSON, App Secret, decrypted key, or minted bearer token.
- **Audit log** every send and credential change.
- **Rotation:** `key_version` enables master-key rotation; provider-credential rotation is a UI re-upload / re-enter.

## 9. Import Pipeline (first-class)

1. Upload **CSV or JSON** for an App.
2. **Map columns** → `token` (required), `provider`, `platform`, `external_user_id`, plus any `attributes`.
3. **Validate** (token present, provider recognized) and report bad rows.
4. **Upsert by `(app_id, token)`** — no duplicates; existing rows updated.
5. Record an `imports` row (counts, who, when).

Apps may **also** register tokens going forward via a small authenticated API endpoint (`POST /api/apps/:id/devices`). Same upsert path.

## 10. Send Pipeline

1. **Compose** — pick App → title/body/`data` → choose **mode** (`notification` vs `data`-only) → choose **target** (all devices / segment by attribute / specific tokens) → **preview recipient count**.
2. **Enqueue** — create `campaign` + `jobs` rows (idempotency key = campaign-id + token chunk).
3. **Worker** — picks jobs, resolves the audience, **splits by provider** (FCM vs Huawei), **chunks to vendor limits**, calls each adapter.
4. **Record** — write `deliveries`; on `DELETE_TOKEN` dispositions mark devices `invalid` (event-driven cleanup); on `RETRY_BACKOFF` requeue with backoff.
5. **History** — campaign view shows sent/failed/invalid counts and per-token results.

At v1 scale the worker runs in-process; it reads from the `jobs` table so it can move to a dedicated container unchanged.

## 11. Authentication (BO)

- Email + password (hashed with argon2/bcrypt), session cookie, roles `admin` / `operator`.
- First admin seeded from env on first boot (`BO_ADMIN_EMAIL` / `BO_ADMIN_PASSWORD`), forced change on first login.
- All app/credential/send routes require auth; sends and credential changes are audited.

## 12. Docker & Cross-OS

- `docker-compose.yml`: `app` (Nuxt+Nitro) + `db` (Postgres) with **named volume** for the DB (no host-path quirks).
- `.gitattributes` forces **LF** so scripts work in the Linux container even when edited on Windows.
- All config via **`.env`** (`.env.example` committed; real `.env` git-ignored).
- **Pinned base image + lockfile** for reproducible builds across machines and across the year.
- Target PC only needs **Docker installed**; `docker compose up` brings the whole system up identically.

## 13. Tech Stack & Rationale

| Layer | Choice | Why |
|---|---|---|
| App | **Nuxt 4 + Nitro** (full-stack TS) | One app for UI + API; matches the owner's existing ClubLedger stack → maintainable for ≥ 1 year |
| ORM | **Drizzle** | Type-safe, lightweight, already in the owner's toolkit |
| DB | **PostgreSQL** | `JSONB` device attributes for fast segmentation; robust for a year of production |
| Queue | **DB-backed `jobs` table** | Durable, retry-able sends with **no extra infra**; splits to a worker container at scale |
| FCM | **Firebase Admin SDK** | Handles JWT signing, scoping, refresh, `sendEach*` for free |
| Huawei | **Thin REST client** | No reliable official Node SDK; REST is simple (ref §3) |
| Crypto | **Node `crypto` AES-256-GCM** | Standard, no dependency |

## 14. Scope — v1 vs Later

**v1 (this build):** companies, apps, FCM + Huawei credentials (encrypted vault), CSV/JSON import + token-registration endpoint, compose + send (all/segment/tokens, notification/data mode), delivery results, event-driven invalid-token cleanup, team auth + audit log, Docker + cross-OS.

**Later (not now):** per-company self-service logins (SaaS), scheduled/recurring sends, A/B testing, analytics dashboards, Redis/queue at high scale, topic-management UI, templates, APNs-direct / web-push-direct / extra channels, KMS-backed envelope encryption.

## 15. Open Questions / To Confirm

1. **Import format** — CSV is assumed primary; confirm your existing export is CSV (and roughly which columns) so the import mapper defaults are right.
2. **Separate iOS/Android Firebase projects?** — if iOS and Android are *separate* Firebase projects (two service-account files), they become two Apps (or one App holding two FCM credentials). Default assumption: one Firebase project per app covers both platforms.
3. **Segmentation depth for v1** — is "all devices" + "specific tokens" enough to start, with attribute-segments as a fast follow, or are attribute-segments needed in v1?

## 16. References

- Provider mechanics, exact endpoints, payload shapes, error→action mapping, security: see the **technical reference** companion doc.
- Prior art: gorush (multi-provider gateway), Novu (`IPushProvider` adapter + integration profiles).
