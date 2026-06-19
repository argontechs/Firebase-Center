# Firebase Center — Design Spec

**Date:** 2026-06-19
**Status:** Reviewed (adversarial self-review pass applied 2026-06-19) — ready for implementation planning
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
- **Store and manage device tokens** (managed audiences) per app, with **first-class bulk import** — both **provider credentials** (CSV manifest + JSON files, to onboard many apps at once) and **device tokens**.
- **Compose and send** to all devices or specific devices from the stored audience; see delivery results; auto-clean dead tokens. *(Attribute-based segments are a fast-follow — §15.)*
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
| R6 | **Bulk import** is first-class — **provider credentials** (CSV manifest + JSON files) **and** device tokens | user |
| R7 | Providers: **FCM + Huawei Push Kit**, each OAuth2 ("2 OAuth") | user |
| R8 | Provider **secrets encrypted at rest**; never returned to client | best practice (ref §6) |
| R9 | Start at **small scale** (≤ ~10k devices) but **no rewrite to scale up** | user + design |

## 4. Domain Model & Terminology

```
Firebase Center (operated by the team)
│
├── Company  "Acme Corp"            ← top-level tenant (label is configurable; rename-safe)
│     ├── App  "Acme Shopper"       ← one App = one logical product
│     │     ├── Credential: FCM (iOS)      — service-account JSON for the iOS Firebase project
│     │     ├── Credential: FCM (Android)  — service-account JSON for the Android Firebase project
│     │     ├── Credential: Huawei         — App ID / App Secret
│     │     └── Devices (imported / registered tokens)  ← audience; each device carries provider + platform
│     └── App  "Acme Rider"
│           ├── Credentials (per platform/provider)
│           └── Devices
├── Company  "Globex"
│     └── App  "Globex Main" → Credentials → Devices
└── … many more companies
```

- **Company** → many **Apps**. Each **App** = a logical product holding **a set of provider credentials (one per platform/project)** + its own device audience.
- **iOS and Android are separate Firebase projects** (two service-account files), so an App holds **multiple FCM credentials** distinguished by platform. A device's `(provider, platform)` selects which credential sends to it: iOS token → iOS service account, Android token → Android service account, Huawei token → Huawei credential.
- "Company" is the v1 label; it lives in a single i18n/label constant so it can be renamed to *Client / Site / Brand* later **without** a data migration (cosmetic only).
- A **Campaign** = one composed message + a target within an App. v1 targets: **all devices** or **specific devices** (selected from the stored audience); `segment` and `topic` are reserved for later (§6 note, §14/§15).
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
- **Token cache** — in-memory access tokens keyed **per credential** (each FCM service account / Huawei app), proactive refresh (< 5 min before 1h expiry).
- **Send pipeline** — campaign → `jobs` rows → worker → adapters → `deliveries` + token cleanup.
- **Import pipelines** — (A) credential import: CSV manifest + `.json` files → upsert company/app/credential (encrypted); (B) device import: CSV/JSON → validate → upsert devices by token.
- **Auth** — team accounts (email + password, roles), session cookie.

## 6. Data Model (PostgreSQL via Drizzle)

```
users        ( id, email, password_hash, role[admin|operator], status[active|disabled], created_at )
companies    ( id, name, status, notes, created_at )
apps         ( id, company_id→companies, name, notes, created_at )
app_credentials ( id, app_id→apps, provider[fcm|huawei], platform[ios|android|huawei|web|any], label,
                  secret_ciphertext, secret_nonce, secret_tag, key_version,
                  meta_jsonb,            -- non-secret: project_id / app_id / huawei_project_id / readiness flags
                  configured_at, rotated_at,
                  UNIQUE(app_id, provider, platform) )   -- (fcm,ios)+(fcm,android) = two separate Firebase projects
                                                         -- platform='any' = one credential serving all platforms
                                                         --   of its provider (e.g. a single Huawei app);
                                                         --   'any' is credential-side only, NOT a devices.platform value
app_ingest_keys ( id, app_id→apps, key_hash, key_prefix, version, label,
                  created_by→users, created_at, revoked_at )   -- per-app, write-only device-registration keys (§11)
devices      ( id, app_id→apps, provider[fcm|huawei] NOT NULL, platform[android|ios|huawei|web] NOT NULL,
               token, external_user_id, attributes_jsonb, status[active|invalid|unsubscribed],
               created_at, last_seen_at,
               UNIQUE(app_id, token) )          -- provider-scoped identity (ref §2)
imports      ( id, app_id→apps, filename, total_rows, inserted, updated, failed,
               status, created_by→users, created_at )
campaigns    ( id, app_id→apps, title, body, data_jsonb, mode[notification|data], priority[high|normal],
               target_type[all|tokens|segment|topic], target_value_jsonb,   -- v1 accepts only all|tokens
               provider_scope[both|fcm|huawei], status, created_by→users, created_at )
deliveries   ( id, campaign_id→campaigns, device_id→devices (nullable), provider, platform,
               token, status[queued|sent|failed|invalid|gave_up], disposition, error_code,
               response_meta, sent_at )
jobs         ( id, type, payload_jsonb, status[pending|running|done|failed],
               attempts, max_attempts, run_after, claimed_at, idempotency_key, last_error, created_at,
               UNIQUE(type, idempotency_key) )  -- DB-backed queue; claimed_at = lease for crash recovery
audit_log    ( id, user_id→users (nullable), action, target_type, target_id, meta_jsonb, created_at )
```

- Per-device `attributes_jsonb` (e.g. `{country, app_version, language}`) is stored for future segmentation via Postgres JSONB indexes (not surfaced in the v1 UI — see §15).
- Secrets stored as `ciphertext + nonce + tag + key_version` (AES-256-GCM); `meta_jsonb` holds only non-secret display data.
- **Device routing & readiness:** a device's `(provider, platform)` resolves which `app_credentials` row sends to it — matching `platform`, or a `platform='any'` credential for that provider (e.g. iOS FCM device → iOS service account; Huawei device → the Huawei credential). The token cache is keyed per credential. A credential is **ready** only when its row exists *and* its `meta_jsonb` readiness flags are satisfied (FCM: APNs `.p8` for iOS / VAPID for web; Huawei: Push Kit enabled). Send-time handling of "no ready credential" is in §10.
- **Reserved target types:** `target_type` accepts only `all` and `tokens` in v1; `segment` (fast-follow, §15) and `topic` (Later, §14) are reserved enum values — stored now to avoid a later migration — and MUST be rejected at the validation layer until built. For `target_type='tokens'`, `target_value_jsonb` stores **device_ids** referencing stored `devices` (never raw token strings — every recipient must carry a known `(provider, platform)`).
- **Job dedupe & lease:** `UNIQUE(type, idempotency_key)` enforces at-most-once enqueue (insert via `ON CONFLICT DO NOTHING`); `claimed_at` is the worker lease for crash recovery (§10). `deliveries.disposition` records the normalized §7 outcome.

## 7. Provider Adapter Layer

A single interface keeps all vendor differences in one place:

```
interface PushProvider {
  mintToken(credential): Promise<AccessToken>       // cached per credential, proactive refresh
  render(NeutralMessage): WireMessage               // project neutral fields → provider wire shape
  send(credential, WireMessage, recipients[]): Promise<DeliveryResult[]>
  // internally: chunk to vendor COUNT limits, apply concurrency/QPS pacing, normalize errors
}

// NeutralMessage = { title, body, image?, data{}, mode[notification|data], priority[high|normal] }
//   mode and priority are provider-NEUTRAL and projected uniformly by each adapter.
```

- **`FcmAdapter`** — HTTP v1 (`/v1/projects/{project_id}/messages:send`); JWT-from-service-account OAuth2; `sendEach*` fanout (≤ 500, 1 req/token); `data` as flat map; projects `priority` → `android.priority` + `apns-priority`. **Caps fanout at ~100 concurrent** requests and honors `Retry-After`.
- **`HuaweiAdapter`** — `client_credentials` OAuth2; v1 (`/v1/{app_id}/...`) **and** v2 (`/v2/{projectId}/...`); native multi-token (≤ 1000); `data` as JSON **string**; must read body `code` (HTTP 200 even on failure); projects `priority` → `android.urgency` (delivery) **and** `android.notification.importance` (display) with the required `category` gate. **Self-imposes a QPS cap + backoff/jitter** per app (Huawei may not return `Retry-After`).
- **Neutral `mode` & `priority` (uniform across providers in a `both` campaign):** `mode=notification` → each adapter includes its notification block; `mode=data` → data-only, no notification block on either provider. v1 ships a fixed default `priority=high`; `mode`/`priority` are not per-provider-selectable in v1.
- **Error normalization** → common dispositions: `DELETE_TOKEN`, `RETRY_BACKOFF`, `FIX_REQUEST` (incl. oversize: FCM `INVALID_ARGUMENT` / Huawei `80300008`), `REAUTH`, `FIX_CREDENTIALS`, `CREDENTIAL_NOT_READY` (targeted `(provider,platform)` group has no ready credential — recorded, never silently dropped). Full mapping in reference §5/§8.
- **Credential resolution** → the pipeline groups recipients by `(provider, platform)` and selects the matching `app_credentials` row (FCM-iOS vs FCM-Android vs Huawei; a `platform='any'` credential matches any platform of its provider); each credential has its own cached access token. A group with no **ready** credential yields `CREDENTIAL_NOT_READY` (see §10).

## 8. Credential Vault & Security

- **AES-256-GCM**, fresh 12-byte nonce per encryption, store nonce + tag + `key_version`.
- **Master key from env** (`BO_MASTER_KEY`) injected via `.env` / docker secret — pragmatic floor for v1, with a documented path to KMS/envelope encryption.
- **Write-only secret fields:** UI accepts the SA JSON / App Secret on save; reads return only metadata (`configured: true`, `project_id` / App ID, fingerprint). Decrypted secrets never leave the server.
- **Never log** the SA JSON, App Secret, decrypted key, or minted bearer token.
- **Audit log** every send, every credential change, and every security-relevant auth/admin event — login success, **login failure (recorded explicitly)**, logout, password change, user create/disable, role change, master-key rotation, and ingest-key issuance/revocation (`audit_log.action` carries this taxonomy; no schema change).
- **Rotation:** `key_version` enables master-key rotation; provider-credential rotation is a UI re-upload / re-enter.
- **Master-key durability (footgun):** `BO_MASTER_KEY` MUST be backed up out-of-band and stored **separately from the DB volume** — the volume holds only ciphertext, so a volume copy without the key is useless, and losing the key with no backup bricks every stored credential. **Recovery from key loss = re-enter all provider secrets** via the write-only UI (regenerate the FCM SA JSON in Firebase Console; Huawei App Secret in AGC). Two live `key_version`s during rotation aid recovery if a historical key survives. (See §12 backup/restore.)

## 9. Import Pipelines (first-class)

Two bulk imports: **(A) credential import** to onboard many apps' provider credentials at once, and **(B) device-token import** for a one-time/bulk migration of an existing audience. Device tokens *also* arrive continuously via the app-ingest API.

### 9A. Credential import — CSV manifest + JSON files
1. Upload a **CSV manifest** plus the FCM **service-account `.json` files** it references (a folder/zip). Each manifest row = one credential.
2. **Manifest columns:** `company` (name), `app` (name), `provider` (`fcm|huawei`), `platform` (`ios|android|huawei|web|any`), `label`, and provider fields — **FCM:** `sa_json_file` (filename of an uploaded service-account JSON) + optional `project_id` (else read from the JSON); **Huawei:** `app_id`, `app_secret`, optional `huawei_project_id` (for the v2 endpoint).
3. **Resolve hierarchy:** upsert **Company** by name, then **App** by `(company, name)` — so one manifest can onboard many companies/apps in a single pass.
4. **Validate:** each referenced `sa_json_file` exists in the upload and parses (extract `project_id`/`client_email`); Huawei rows have `app_id`+`app_secret`; `(provider, platform)` is valid. Bad rows are rejected and reported (no partial-secret writes).
5. **Encrypt & upsert** each credential into `app_credentials` via the vault (AES-256-GCM, §8), keyed by `(app_id, provider, platform)`; secrets become write-only thereafter. Every created/updated credential is audited; the raw `.json`/secret is never persisted unencrypted or logged.

### 9B. Device-token import — CSV/JSON, per App
1. Upload **CSV or JSON** for an App.
2. **Map columns** → `token` (**required**), `provider` (**required**), `platform` (**required**), `external_user_id` (optional), plus any `attributes`. The mapper offers a per-import **default provider/platform** for when a column is absent.
3. **Validate** — `token` present; `provider` recognized; `platform` present and **consistent with provider** (`huawei`⇒`huawei`; `fcm`⇒{`ios`,`android`,`web`}). Unroutable rows are **rejected into `imports.failed`** (never inserted as silently-undeliverable) and reported back.
4. **Upsert by `(app_id, token)`** — no duplicates; existing rows updated.
5. Record an `imports` row (counts, who, when).

Apps **also** register tokens continuously via the **app-ingest endpoint** `POST /api/apps/:id/devices`, authenticated by a **per-app ingest key** (not the operator session — see §11), bound to its App and whitelisted to set only `token`/`provider`/`platform`/`external_user_id`. Same validation + upsert path as 9B.

## 10. Send Pipeline

1. **Compose** — pick App → title/body/`data` → choose **mode** (`notification` vs `data`-only) and **priority** (default `high`) → choose **target** (v1: **all devices** or **specific devices** selected from the stored audience). The BO **validates the rendered payload ≤ 4096 bytes per adapter** (Huawei measured excluding the token list) and shows a **recipient preview broken down per `(provider, platform)`**, flagging any group whose credential isn't **ready** (§6/§7).
2. **Enqueue** — create the `campaign` and its `jobs` rows via `INSERT … ON CONFLICT (type, idempotency_key) DO NOTHING`, with a deterministic key `campaign_id + ':' + chunk_index`, so a double-submit or enqueue-retry cannot duplicate work.
3. **Worker** — claims jobs atomically with `SELECT … FOR UPDATE SKIP LOCKED` (safe when a second worker is later added), resolves the audience, **splits by `(provider, platform)`** to the matching credential, **chunks to vendor count limits** (FCM ≤500-array fanout / Huawei ≤1000), and calls each adapter (each applies its own concurrency/QPS pacing, §7). A targeted group with **no ready credential** is recorded as `CREDENTIAL_NOT_READY`; reachable groups still send. **Crash recovery:** `claimed_at` is a lease — a periodic sweep returns `running` jobs older than a visibility timeout to `pending`. v1 runs **one** in-process worker (short poll interval now; `LISTEN/NOTIFY` is a no-schema-change upgrade).
4. **Record & retry** — write `deliveries`; on `DELETE_TOKEN` mark devices `invalid` (event-driven cleanup). **Only `RETRY_BACKOFF` is retried** (exponential backoff + jitter, honoring FCM `Retry-After`) up to `jobs.max_attempts`. **Non-transient dispositions** (`REAUTH`, `FIX_CREDENTIALS`, `FIX_REQUEST`, `CREDENTIAL_NOT_READY`) go **straight to terminal `failed`** with `last_error` set — never retried. On retry exhaustion the job → `failed` and its rows → `deliveries.status='gave_up'`.
5. **History** — campaign view shows **sent / failed / invalid / gave-up / not-ready** counts and per-device results.

At v1 scale the worker runs in-process; it reads the `jobs` table (with `SKIP LOCKED` + `claimed_at` lease) so it splits to a dedicated container with **no schema change**.

## 11. Authentication (BO)

**Operator auth — the BO trust boundary (R4):**
- Email + password (hashed with **argon2id**/bcrypt), **cookie session**, roles `admin` / `operator`.
- **Session hardening:** cookie `HttpOnly` + `Secure` + `SameSite=Lax` (Strict for highest-impact routes); **idle + absolute timeout**; sessions invalidated on the forced first-login change and any password reset.
- **CSRF:** state-changing routes (credential write §8, enqueue-send §10, operator-driven import §9) require a CSRF token / double-submit + origin check on top of `SameSite`. *(The app-ingest endpoint below is exempt — it is not a browser action and uses bearer-key auth.)*
- **Brute-force defense:** per-account **and** per-IP login rate-limiting with exponential backoff + temporary lockout; **failed logins written to `audit_log`**.
- **First-admin seed:** seeded **only when the `users` table is empty** (idempotent — later boots never reset an existing admin). The seeded `BO_ADMIN_PASSWORD` must meet a minimum-strength policy, is **single-use**, and is invalidated by the forced first-login change. If `users` is empty **and** `BO_ADMIN_*` are unset, **boot fails loudly** rather than coming up unloginnable. (Runs after migrations — §12.)

**App-ingest auth — for `POST /api/apps/:id/devices`, distinct from operator auth:**
- Each App issues one or more **ingest keys** (`app_ingest_keys`): random, **hashed at rest**, shown **once** on creation (mirrors §8 write-only rule), **rotatable** and **revocable**.
- Presented as `Authorization: Bearer <key>`; **bound to its App** (cannot write another app's audience); **scoped strictly** to device registration (whitelist `token`/`provider`/`platform`/`external_user_id`; no read, no other routes).
- **Per-key / per-IP rate-limiting**; key issuance and revocation are audited.

All operator routes require the session; sends, credential changes, and auth/admin events are audited (§8). Given the blast radius (decryptable provider secrets + push to all audiences), a **network boundary** (VPN / IP allowlist) in front of the BO is recommended.

## 12. Docker & Cross-OS

- `docker-compose.yml`: `app` (Nuxt+Nitro) + `db` (Postgres) with **named volume** for the DB (no host-path quirks).
- `.gitattributes` forces **LF** so scripts work in the Linux container even when edited on Windows.
- All config via **`.env`** (`.env.example` committed; real `.env` git-ignored).
- **Pinned base image + lockfile** for reproducible builds across machines and across the year.
- **Bring-up sequence (load-bearing for R1/R2):** the `app` entrypoint **waits for Postgres readiness → applies committed versioned Drizzle migrations idempotently** (never `drizzle-kit push` against prod) **→ seeds the first admin if absent (§11) → starts Nitro and serves**. A fresh named volume thus self-initializes its tables *before* the server accepts traffic.
- **Resilience:** both services declare `restart: unless-stopped`; `app` waits on a DB **healthcheck** (`depends_on: { db: { condition: service_healthy } }`) or retries its DB connection — so a first-boot race or host reboot self-recovers instead of staying down.
- **Backup & restore:** the irreplaceable assets (encrypted credentials, audiences, campaign history) are protected by scheduled/manual **`pg_dump` retained off-host**. **A DB backup is useless without `BO_MASTER_KEY`** (the volume holds only ciphertext) — back the key up **separately** and restore requires **both**.
- Target PC only needs **Docker installed**; `docker compose up` brings the whole system up identically — **provided `BO_MASTER_KEY` is provisioned separately** (it is never in the volume or git; see §8).

## 13. Tech Stack & Rationale

| Layer | Choice | Why |
|---|---|---|
| App | **Nuxt 4 + Nitro** (full-stack TS) | One app for UI + API; matches the owner's existing ClubLedger stack → maintainable for ≥ 1 year |
| ORM | **Drizzle** | Type-safe, lightweight, already in the owner's toolkit |
| DB | **PostgreSQL** | `JSONB` device attributes for fast segmentation; robust for a year of production |
| Queue | **DB-backed `jobs` table** | Durable, retry-able sends with **no extra infra**; `SELECT … FOR UPDATE SKIP LOCKED` + `claimed_at` lease make the future worker-container split a no-migration change |
| FCM | **Firebase Admin SDK** | Handles JWT signing, scoping, refresh, `sendEach*` for free |
| Huawei | **Thin REST client** | No reliable official Node SDK; REST is simple (ref §3) |
| Crypto | **Node `crypto` AES-256-GCM** | Standard, no dependency |

## 14. Scope — v1 vs Later

**v1 (this build):** companies, apps, **per-platform** FCM + Huawei credentials (encrypted vault), **bulk credential import (CSV manifest + `.json` files, upserts company/app/credential)**, device-token import (CSV/JSON with column-mapping) + per-app-key app-ingest endpoint, compose + send (**all-devices** or **specific-devices**, notification/data mode, default-high priority, ≤4 KB payload validation), delivery results + event-driven invalid-token cleanup, retry-with-ceiling + dead-letter (`gave_up`), team auth (session hardening, CSRF, brute-force defense) + full audit log, DB-migrations-on-boot + backup/restore, Docker + cross-OS.

**Later (not now):** **attribute-based audience segments**, per-company self-service logins (SaaS), scheduled/recurring sends, A/B testing, analytics dashboards, Redis/queue at high scale, topic-management UI, templates, APNs-direct / web-push-direct / extra channels, KMS-backed envelope encryption.

## 15. Resolved Decisions (review, 2026-06-19)

1. **Separate iOS/Android Firebase projects.** The owner keeps **two Firebase projects** — one iOS, one Android — so each App holds **multiple FCM service-account credentials** (plus optional Huawei), modeled as `app_credentials` rows keyed by `(provider, platform)`. A device's `(provider, platform)` routes it to the correct credential.
2. **Bulk import covers two things (decided 2026-06-19).** (a) **Credential import** — a **CSV manifest + the referenced FCM `.json` files**; it upserts Company→App→credential so many apps onboard in one pass (the chunky FCM service-account JSON stays in real files, not CSV cells). (b) **Device-token import** — CSV/JSON per App with a column-mapping step. Device tokens also arrive continuously via the app-ingest API. (See §9A/§9B.)
3. **v1 targeting — all-devices + specific-devices only.** "Specific devices" = a selection of stored `devices` (each carries its `(provider, platform)` for routing), **not** raw pasted tokens. **Attribute-based segments and topic sends are out of v1 scope** — `segment`/`topic` remain reserved enum values rejected at the API until built (segment = fast-follow §15; topic = Later §14). `attributes_jsonb` is still stored now so segments can be added later with no migration.

## 16. References

- Provider mechanics, exact endpoints, payload shapes, error→action mapping, security: see the **technical reference** companion doc.
- Prior art: gorush (multi-provider gateway), Novu (`IPushProvider` adapter + integration profiles).
