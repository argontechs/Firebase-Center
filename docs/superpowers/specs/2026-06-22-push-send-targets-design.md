# Firebase Center — Push Send & Targets (top-level) — Design Spec

**Date:** 2026-06-22
**Status:** Approved (brainstorm) — pending spec review
**Author:** Claude + owner

## 1. Problem & goal

The send engine (FCM + Huawei adapters, DB-backed queue/worker, campaigns, deliveries, device import, delivery tracking) is already built and green, but it is **buried under each App's tabs** (App → *Compose* to send, App → *Devices* to add recipients). The global nav shows only *Sites* and *Import credentials*, so the product reads as "credential storage." Operators cannot find the push workflow.

**Goal:** Make sending and targeting **first-class, top-level** surfaces, and add the three capabilities the owner asked for: **manual target entry**, **tag/filter-based audiences**, and **scheduling**. Reuse the existing engine; do not rebuild it.

## 2. Non-goals (YAGNI for v1)

Message templates, A/B testing, analytics dashboards, rich media beyond the current notification fields, manual hand-picked audience membership, cross-app *saved* audiences. (Cross-app sending is supported via broadcast + ad-hoc filter — §7.)

## 3. Information architecture

Left sidebar becomes:

> **Sites** · **Targets** · **Send** · **History** · *Import credentials*

- **Sites** — unchanged (Sites → Apps → per-app *Credentials* + *Ingest keys* config).
- **Targets** — new top-level recipient manager (§5, §6).
- **Send** — new top-level composer (§7).
- **History** — elevate the existing per-app campaign history to top-level, with an App filter.
- The per-App detail page **drops** its *Compose / Devices / History* tabs (replaced by the top-level pages) and keeps *Credentials* + *Ingest keys*. It gains quick links: "View targets for this app" and "Send to this app" that deep-link to the top-level pages pre-filtered by `appId`.

## 4. Data model changes (additive)

All changes are new migrations; existing columns are untouched.

- **`devices`**: add `tags text[] NOT NULL DEFAULT '{}'`. Settable on manual add and via an optional `tags` column on bulk import (comma-separated → array). GIN index on `tags` for filtering.
- **New `audiences` table**:
  - `id uuid pk`, `app_id uuid fk → apps(id) ON DELETE CASCADE`, `name text NOT NULL`,
  - filter columns (all nullable = "any"): `platform platform_enum`, `provider provider_enum`, `tag text`,
  - `created_by uuid`, `created_at timestamptz default now()`.
  - `UNIQUE(app_id, name)`.
- **`campaigns`**: add
  - `scheduled_at timestamptz NULL` (null = send now),
  - `audience_id uuid NULL fk → audiences(id) ON DELETE SET NULL` (provenance; the resolved filter is also snapshotted so deleting an audience never changes an in-flight/historical send),
  - `audience_filter jsonb NULL` (snapshot of `{platform?, provider?, tag?}` at send time),
  - `broadcast_id uuid NULL` (groups campaigns created by one multi-app send),
  - extend the status enum with `scheduled` and `canceled`.
- **`jobs`** already carries `campaign_id` (from the F6 fix) — reused for scheduling/finalization.

## 5. Targets page

Route `app/pages/targets/index.vue`. Tabs: **Devices** (default) and **Audiences** (§6).

**Devices tab:**
- Filter bar: App (select), platform, provider, tag, free-text token/user-id search.
- Table: masked token (`.mono`), platform, provider, tags (badges), status badge (`active`/`invalid`), added date. Row actions: edit tags, delete.
- **+ Add target** → `.panel` form: App (required), token (required, `.mono`), platform + provider (required), optional external user ID, optional tags (comma/space input → chips). Validates token non-empty and uniqueness per `(app_id, token)`; maps to the existing `devices` insert. Operator-authed (session + CSRF), distinct from the bearer-key ingest path.
- **Bulk import** → the existing device CSV/JSON wizard, relocated here (App chosen at top); the importer learns the optional `tags` column.

**Endpoints:**
- `GET /api/devices?appId=&platform=&provider=&tag=&q=&limit=&cursor=` — operator-authed, paginated list across apps (scoped to apps the operator can see).
- `POST /api/apps/:id/devices/manual` — operator-authed manual add (session + CSRF). (The existing bearer-key `POST /api/apps/:id/devices` ingest route is unchanged.)
- `PATCH /api/devices/:id` — edit tags. `DELETE /api/devices/:id` — remove.

## 6. Audiences

**Model:** an audience is a **saved, per-app filter** — `{ app_id, name, platform?, provider?, tag? }`. Membership is dynamic: a device matches when its `app_id` equals and each non-null filter field matches (`tag` matches when `tag = ANY(devices.tags)`). Only `status='active'` devices count.

**Audiences tab (in Targets):**
- List: name, App, the filter summary, **live matching-device count**, created date. Actions: edit, delete.
- **+ New audience** → form: App, name, optional platform/provider/tag; shows the live count as you set the filter.

**Endpoints (operator-authed):**
- `GET /api/apps/:id/audiences` (each row includes the current resolved count).
- `POST /api/apps/:id/audiences`, `PATCH /api/apps/:id/audiences/:aid`, `DELETE /api/apps/:id/audiences/:aid`.
- Resolution logic lives in a shared `server/utils/audiences/resolve.ts`, reused by both the count endpoint and the send pipeline.

## 7. Send page

Route `app/pages/send/index.vue`. A guided composer:

1. **Apps** — single-select (default) or multi-select toggle for a **broadcast**.
2. **Recipients**
   - Single app: *All devices* · *an Audience* (dropdown of that app's audiences) · *Specific devices* (search/pick) · *Ad-hoc filter* (platform/provider/tag).
   - Broadcast (multi-app): *All devices* · *Ad-hoc tag/platform filter* applied per app (saved audiences are per-app, so not offered for broadcast).
3. **Message** — title, body, data (JSON), mode (`notification`/`data`), priority (`high`/`normal`) — the existing compose fields and validation (4 KB payload guard reused).
4. **When** — *Send now* or *Schedule* (date-time picker; must be in the future).
5. **Preview & confirm** — calls preview to show recipient count **per (provider, platform)** with credential-not-ready flags; broadcast shows a per-app breakdown. Then **Send** / **Schedule**.

**Behavior:** For each selected app, the server resolves recipients → creates a `campaigns` row (snapshotting `audience_filter`), and either **enqueues immediately** (send now, via the existing `enqueueCampaign`) or sets `status='scheduled'` + `scheduled_at`. A broadcast assigns a shared `broadcast_id` across the per-app campaigns.

**Endpoints:**
- Extend `POST /api/campaigns/preview` to accept `{ appId, recipients }` where `recipients` is `{type: 'all'|'audience'|'devices'|'filter', audienceId?, deviceIds?, filter?}`.
- Replace/extend `POST /api/campaigns` to accept `{ appIds[], recipients, message, scheduledAt? }`. Returns the created campaign id(s) + `broadcast_id` when multi-app. (The send-API `POST /api/v1/messages` may later gain `scheduledAt`/audience support; not in this v1.)

## 8. Scheduling mechanism

No new service. The existing **worker loop** (`server/utils/queue/loop.ts`) gains a **due-campaign sweep** each tick:

```
SELECT id FROM campaigns
WHERE status = 'scheduled' AND scheduled_at <= now()
FOR UPDATE SKIP LOCKED;          -- claim due campaigns
-- for each: enqueueCampaign(id); UPDATE status = 'sending'
```

- Idempotent and crash-safe (same `SKIP LOCKED` + idempotent enqueue patterns already used).
- **Cancel:** `POST /api/campaigns/:id/cancel` transitions `scheduled → canceled` (only while still scheduled). History shows scheduled time and a Cancel action.
- Scheduled and canceled campaigns are visible in History; finalization (`done`/`failed`) still flows from the F6 job-lifecycle reconciliation once enqueued.

## 9. Reused as-is

FCM/Huawei adapters, queue + worker + retry/dead-letter, campaigns/deliveries tables, `enqueueCampaign`, payload validation, device-import parsing, delivery/invalid-token cleanup, the compose field set, auth/CSRF/audit. Audience resolution generalizes the current "all / specific tokens" logic.

## 10. Migration & compatibility

- New migrations only (`devices.tags`, `audiences`, `campaigns.*`, status enum values). Applied on boot by the entrypoint; `globalSetup` applies them for tests.
- Existing campaigns (no `scheduled_at`) behave as "send now" — unchanged.
- Per-app `compose.vue` / `devices.vue` / `history.vue` routes are removed; `/apps/:id` redirects its old tab links to the top-level pages pre-filtered by `appId`. Their component tests are migrated/retired accordingly.

## 11. Testing strategy

- **Unit:** audience resolution (each filter combination, tag ANY-match, active-only); scheduling due-sweep (due vs not-due, claim once); manual-add validation (empty/duplicate token); tags CSV parsing.
- **Integration:** audiences CRUD + count; `POST /api/apps/:id/devices/manual`; `GET /api/devices` filtering + tenant scoping; `POST /api/campaigns` single + broadcast + scheduled; cancel; preview breakdown.
- **Lifecycle:** a scheduled campaign fires after `scheduled_at` and finalizes via the worker; a canceled one never enqueues.
- Keep the existing suite green; reuse `resetDb` + `globalSetup`.

## 12. Decisions made (resolved during brainstorm)

- Top-level **Targets** + **Send** + **History** (not per-app shortcuts).
- Targets get in via **manual add + bulk upload + audiences**.
- Audiences are **filter/tag-based**, **per-app**, dynamic.
- Send scope is **both** (single app default, multi-app broadcast).
- **Scheduling** included in v1 (send-now + schedule-for-later + cancel).
- Cross-app broadcasts use an **ad-hoc filter** (no cross-app saved audiences).
