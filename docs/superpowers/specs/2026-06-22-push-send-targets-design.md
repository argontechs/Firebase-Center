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

All changes are new migrations; existing columns are untouched. The audience send **reuses the existing** `campaigns.targetType` enum (which already reserves `segment`) and `targetValueJsonb`, instead of new campaign columns.

- **`devices`**: add `tags text[] NOT NULL DEFAULT '{}'` with a **GIN index** for tag filtering. Settable on manual add and via an optional `tags` column on bulk import (comma-separated → array). (`devices.externalUserId` and `attributesJsonb` already exist and are untouched.)
- **New `audiences` table** (saved filter definitions):
  - `id uuid pk`, `app_id uuid fk → apps(id) ON DELETE CASCADE`, `name text NOT NULL`,
  - filter columns (all nullable = "any"): `platform device_platform`, `provider provider`, `tag text`,
  - `created_by uuid`, `created_at timestamptz default now()`.
  - `UNIQUE(app_id, name)`.
- **`campaigns`**: add only
  - `scheduled_at timestamptz NULL` (null = send now),
  - `broadcast_id uuid NULL` (groups the per-app campaigns created by one multi-app send),
  - extend the `campaign_status` enum with `scheduled` and `canceled`.
  - An **audience send** sets `targetType='segment'` and snapshots the resolution into `targetValueJsonb = { audience_id?: uuid, filter: { platform?, provider?, tag? } }`. Snapshotting the filter means deleting an audience never alters an in-flight or historical send. (No `audience_id`/`audience_filter` columns are needed.)
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
- Resolution logic lives in a shared `server/utils/audiences/resolve.ts`, reused by both the count endpoint and the send pipeline. The pipeline's `resolveAudience`/`previewAudience` (in `server/utils/queue/enqueue.ts` and `server/utils/campaigns/audience.ts`) gain a `segment` branch that reads `targetValueJsonb.filter` and applies the same predicate — replacing today's reserved-value rejection.

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

**Endpoints (operator-authed). The UI `recipients` choice maps to the existing `targetType`/`targetValue`:** `all`→`all`; `specific devices`→`tokens` (`{device_ids}`); `audience`/`ad-hoc filter`→`segment` (`{audience_id?, filter}`).
- `POST /api/campaigns/preview` — extend to accept `targetType='segment'` with `targetValue={audience_id?, filter}`; returns per-(provider, platform) counts. Single app.
- `POST /api/campaigns` — single-app, **extended and backward-compatible**: also accepts `targetType='segment'` and an optional `scheduledAt`. When `scheduledAt` is a future time it inserts `status='scheduled'` and does **not** enqueue; otherwise behaviour is unchanged (insert `queued` + `enqueueCampaign`).
- `POST /api/campaigns/broadcast` — **new**, multi-app: `{ appIds[], message, recipients, scheduledAt? }`. Reuses the single-app create logic per app, assigns a shared `broadcast_id`, returns `{ broadcastId, campaignIds }`.
- `POST /api/campaigns/:id/cancel` — `scheduled → canceled` (only while still scheduled).
- The send-API `POST /api/v1/messages` is **unchanged** in v1 (no audiences/scheduling).

## 8. Scheduling mechanism

No new service. `startWorkerLoop` (`server/utils/queue/loop.ts`) already runs two timers (job-drain ~1 s, stale-job sweep ~5 min); we add a **third timer (~5 s)** calling a new `sweepDueCampaigns()` (`server/utils/queue/due.ts`). A partial index on `campaigns (scheduled_at) WHERE status='scheduled'` keeps the sweep cheap. Each run:

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
