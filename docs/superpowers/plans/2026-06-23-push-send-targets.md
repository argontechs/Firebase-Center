# Push Send & Targets (top-level) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote push sending and recipient management to first-class top-level pages, and add manual target entry, tag/filter-based audiences, and scheduling, reusing the existing send engine.

**Architecture:** Additive DB migrations (devices.tags, an `audiences` table, `campaigns.scheduled_at`/`broadcast_id` + two status enum values). Audience sends reuse the existing `campaigns.targetType='segment'` + `targetValueJsonb` rather than new columns. Scheduling is a third timer in the existing worker loop. New top-level Nuxt pages (Targets, Send, History) drive the existing campaign/queue/adapter pipeline.

**Tech Stack:** Nuxt 3.14 (compat v4, srcDir `app/`), Nitro server routes, Drizzle ORM, PostgreSQL, Zod, Vitest.

## Global Constraints

- Server-to-server imports use `~~/server/...` (rootDir). Client composables use `~/composables/...` (never `~/app/composables`). tsx-run scripts (migrate/seed) use RELATIVE imports.
- Run `pnpm run build` (must print "Build complete!") at the end of every task that touches server or build-affecting code. The full Vitest suite must stay green (currently **483 passed, 1 skipped**); the test Postgres runs at `postgres://fc:fc@localhost:55432/firebase_center_test` and `globalSetup` applies migrations.
- Client mutations call `useCsrf().fetchToken()` then send `useCsrf().headers()`; operator routes are session + CSRF guarded via `requireSession`/the global middleware. `/api/v1/*` and the bearer ingest route stay CSRF-exempt and unchanged.
- UI follows `DESIGN.md` class contracts (`.page-head`, `.panel`, `.btn`/`.btn-primary`/`.btn-ghost`/`.btn-danger`, `.field`, `.table`, `.badge*`, `.callout`, `.empty`, `.tab-strip`/`.tab-item`). No `#000`/`#fff`, no em dashes in UI copy, preserve every `data-test` hook.
- Migrations: `pnpm db:generate` then apply with `NUXT_DATABASE_URL=postgres://fc:fc@localhost:55432/firebase_center_test pnpm db:migrate`. Never `drizzle-kit push`.

## Shared interfaces (used across tasks)

```ts
// server/utils/audiences/resolve.ts
export interface AudienceFilter { platform?: 'android'|'ios'|'huawei'|'web'; provider?: 'fcm'|'huawei'; tag?: string }
export function audienceWhere(appId: string, filter: AudienceFilter): SQL  // drizzle and(...) predicate, status='active' + appId + non-null filter fields
export function resolveAudienceDevices(appId: string, filter: AudienceFilter): Promise<typeof devices.$inferSelect[]>
export function countAudience(appId: string, filter: AudienceFilter): Promise<number>

// segment campaigns store this in targetValueJsonb:
// { audience_id?: string, filter: AudienceFilter }
```

UI `recipients` → campaign mapping: `all`→`targetType:'all'`; `specific`→`'tokens'` (`{device_ids}`); `audience`/`filter`→`'segment'` (`{audience_id?, filter}`).

---

## File Structure

- `server/db/schema.ts` — add `devices.tags`, `audiences` table, `campaigns.scheduledAt`/`broadcastId`, enum values. **(A1)**
- `server/db/migrations/00NN_*.sql` — generated migration. **(A1)**
- `server/utils/audiences/resolve.ts` — shared filter predicate + resolve/count. **(B1)**
- `server/utils/queue/enqueue.ts`, `server/utils/campaigns/audience.ts` — add `segment` branch. **(B2)**
- `server/api/apps/[id]/audiences/*` — audiences CRUD. **(C1)**
- `server/api/devices/*` + `server/api/apps/[id]/devices/manual.post.ts` — targets list/manual-add/edit/delete. **(D1, D2)**
- `server/utils/import/devices.ts` (existing) — optional `tags` column. **(D3)**
- `server/api/campaigns/{preview.post.ts,index.post.ts,broadcast.post.ts,[id]/cancel.post.ts}` — send + schedule + broadcast + cancel. **(E1–E3)**
- `server/utils/queue/due.ts` + `server/utils/queue/loop.ts` — scheduling sweep. **(F1)**
- `app/layouts/default.vue`, `app/pages/apps/[id].vue` — nav + per-app tabs. **(G1)**
- `app/pages/targets/index.vue`, `app/pages/send/index.vue`, `app/pages/history/index.vue` — new pages. **(G2–G5)**

---

## Task A1: Data model + migration

**Files:**
- Modify: `server/db/schema.ts`
- Create: `server/db/migrations/<generated>.sql`
- Test: `test/integration/schema-push-targets.test.ts`

**Interfaces:**
- Produces: `devices.tags: string[]`; `audiences` table (`audiences.$inferSelect`); `campaigns.scheduledAt: Date|null`, `campaigns.broadcastId: string|null`; `campaignStatus` includes `'scheduled'|'canceled'`.

- [ ] **Step 1: Write the failing test** — `test/integration/schema-push-targets.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '~~/server/db/client';
import { devices, audiences, campaigns, apps, companies } from '~~/server/db/schema';
import { resetDb } from '~~/server/test/db';
import { eq } from 'drizzle-orm';

let appId = '';
beforeEach(async () => {
  await resetDb();
  const [c] = await db.insert(companies).values({ name: 'C' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'A' }).returning();
  appId = a.id;
});

it('devices carry a tags array defaulting to empty', async () => {
  const [d] = await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: 't1' }).returning();
  expect(d.tags).toEqual([]);
  const [d2] = await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: 't2', tags: ['vip','kl'] }).returning();
  expect(d2.tags).toEqual(['vip','kl']);
});

it('audiences store a per-app named filter', async () => {
  const [au] = await db.insert(audiences).values({ appId, name: 'VIP Android', platform: 'android', tag: 'vip' }).returning();
  expect(au.name).toBe('VIP Android');
  expect(au.platform).toBe('android');
});

it('campaigns accept scheduled status + scheduled_at + broadcast_id', async () => {
  const when = new Date('2030-01-01T00:00:00Z');
  const [camp] = await db.insert(campaigns).values({
    appId, title: 'T', body: 'B', targetType: 'segment',
    targetValueJsonb: { filter: { tag: 'vip' } }, status: 'scheduled', scheduledAt: when, broadcastId: '00000000-0000-0000-0000-000000000001',
  }).returning();
  expect(camp.status).toBe('scheduled');
  expect(camp.scheduledAt?.toISOString()).toBe(when.toISOString());
});
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm vitest run test/integration/schema-push-targets.test.ts` → fails (`tags`/`audiences`/`scheduledAt` unknown).

- [ ] **Step 3: Edit `server/db/schema.ts`:**
  - In `campaignStatus`: `pgEnum('campaign_status', ['draft','queued','sending','done','failed','scheduled','canceled'])`.
  - In `devices` table add: `tags: text('tags').array().notNull().default(sql\`'{}'::text[]\`),` (import `sql` from `drizzle-orm`).
  - In `campaigns` table add: `scheduledAt: timestamp('scheduled_at', { withTimezone: true }),` and `broadcastId: uuid('broadcast_id'),`.
  - Add the table:
```ts
export const audiences = pgTable('audiences', {
  id: uuid('id').defaultRandom().primaryKey(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  name: text('name').notNull(),
  platform: devicePlatform('platform'),
  provider: providerEnum('provider'),
  tag: text('tag'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique().on(t.appId, t.name) }));
```

- [ ] **Step 4: Generate + apply migration:**
```bash
pnpm db:generate
NUXT_DATABASE_URL=postgres://fc:fc@localhost:55432/firebase_center_test pnpm db:migrate
```
Then hand-edit the new migration SQL to add the partial index used by scheduling and the GIN index for tags (drizzle-kit will not infer these):
```sql
CREATE INDEX IF NOT EXISTS devices_tags_gin ON devices USING gin (tags);
CREATE INDEX IF NOT EXISTS campaigns_due_idx ON campaigns (scheduled_at) WHERE status = 'scheduled';
```
Re-apply: `NUXT_DATABASE_URL=...test pnpm db:migrate`.

- [ ] **Step 5: Update `server/test/db.ts`** — add `'audiences'` to `ALL_TABLES` (before `apps`, after `devices`, so CASCADE/order is safe; it FK-references apps).

- [ ] **Step 6: Run test + build:** `pnpm vitest run test/integration/schema-push-targets.test.ts` PASS; `pnpm run build` → "Build complete!".

- [ ] **Step 7: Commit** — `git commit -am "feat(db): devices.tags + audiences table + campaign scheduling/broadcast columns"`

---

## Task B1: Shared audience resolver

**Files:**
- Create: `server/utils/audiences/resolve.ts`
- Test: `server/utils/audiences/resolve.test.ts`

**Interfaces:**
- Produces: `AudienceFilter`, `audienceWhere(appId, filter)`, `resolveAudienceDevices(appId, filter)`, `countAudience(appId, filter)` (see Shared interfaces).

- [ ] **Step 1: Write the failing test** — `server/utils/audiences/resolve.test.ts`: seed 4 active devices for one app (fcm/android tag vip; fcm/ios; huawei/huawei tag vip; fcm/android no tag) + 1 invalid + 1 other-app; assert:
  - `countAudience(appId, {})` → 4 (active, this app only).
  - `countAudience(appId, { platform: 'android' })` → 2.
  - `countAudience(appId, { provider: 'huawei' })` → 1.
  - `countAudience(appId, { tag: 'vip' })` → 2.
  - `countAudience(appId, { platform: 'android', tag: 'vip' })` → 1.
  - `resolveAudienceDevices` returns the matching rows, active only.

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement `resolve.ts`:**
```ts
import { db } from '~~/server/db/client';
import { devices } from '~~/server/db/schema';
import { and, eq, sql, type SQL } from 'drizzle-orm';

export interface AudienceFilter { platform?: 'android'|'ios'|'huawei'|'web'; provider?: 'fcm'|'huawei'; tag?: string }

export function audienceWhere(appId: string, filter: AudienceFilter): SQL {
  const parts = [eq(devices.appId, appId), eq(devices.status, 'active')];
  if (filter.platform) parts.push(eq(devices.platform, filter.platform));
  if (filter.provider) parts.push(eq(devices.provider, filter.provider));
  if (filter.tag) parts.push(sql`${filter.tag} = ANY(${devices.tags})`);
  return and(...parts) as SQL;
}
export function resolveAudienceDevices(appId: string, filter: AudienceFilter) {
  return db.select().from(devices).where(audienceWhere(appId, filter))
    .orderBy(devices.provider, devices.platform, devices.id);
}
export async function countAudience(appId: string, filter: AudienceFilter): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(devices).where(audienceWhere(appId, filter));
  return r?.n ?? 0;
}
```

- [ ] **Step 4: Run test PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(audiences): shared filter resolver (platform/provider/tag, active-only)"`

---

## Task B2: `segment` branch in the send pipeline

**Files:**
- Modify: `server/utils/queue/enqueue.ts` (`resolveAudience`), `server/utils/campaigns/audience.ts` (`previewAudience`)
- Test: `test/integration/enqueue.test.ts` (extend), `server/utils/campaigns/audience.test.ts` (extend or create)

**Interfaces:**
- Consumes: B1 `resolveAudienceDevices`. Produces: `enqueueCampaign`/`previewAudience` accept `targetType='segment'` with `targetValueJsonb.filter`.

- [ ] **Step 1: Failing test** in `test/integration/enqueue.test.ts`: create a campaign with `targetType:'segment'`, `targetValueJsonb:{ filter:{ tag:'vip' } }` over seeded devices; assert `enqueueCampaign` creates jobs only for the vip devices' (provider,platform) groups.
- [ ] **Step 2: Run, expect FAIL** (throws `unsupported target_type segment`).
- [ ] **Step 3:** In `resolveAudience`, replace the `segment|topic` throw with:
```ts
if (camp.targetType === 'segment') {
  const tv = camp.targetValueJsonb as { filter?: AudienceFilter };
  const rows = await resolveAudienceDevices(camp.appId, tv.filter ?? {});
  return camp.providerScope === 'both' ? rows : rows.filter(d => d.provider === camp.providerScope);
}
throw new Error(`unsupported target_type ${camp.targetType}`); // topic still reserved
```
(Import `resolveAudienceDevices`, `AudienceFilter`.) Mirror a `segment` branch in `previewAudience` (read `server/utils/campaigns/audience.ts` first; it currently handles `all`/`tokens` — add `segment` using `resolveAudienceDevices` then group).
- [ ] **Step 4: Run tests PASS; `pnpm run build`.**
- [ ] **Step 5: Commit** — `git commit -am "feat(send): resolve segment audiences in enqueue + preview"`

---

## Task C1: Audiences CRUD API

**Files:**
- Create: `server/api/apps/[id]/audiences/index.get.ts`, `index.post.ts`, `[aid]/index.patch.ts`, `[aid]/index.delete.ts`
- Test: `test/integration/audiences.test.ts`

**Interfaces:**
- Consumes: B1 `countAudience`. Produces: REST audiences for the Targets UI (each list row includes `count`).

- [ ] **Step 1: Failing tests** — operator session helper (reuse existing test login helper, e.g. `loginAs`/session cookie pattern from `test/integration/*` — read one first). Assert: POST creates (422 on missing name; 409 on duplicate name per app via the existing unique-violation helper `isUniqueViolation`); GET lists with live `count`; PATCH updates filter + count changes; DELETE removes; cross-tenant: an audience under app B is not returned/edited via app A.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the four handlers.** Use `requireSession(event)`, validate body with Zod (`name: string.min(1)`, `platform`/`provider`/`tag` optional), wrap insert/update in the existing `isUniqueViolation` → 409 helper (`server/utils/db-errors.ts`), `audit({action:'audience_save'|'audience_delete', ...})`. GET maps each row to `{ ...row, count: await countAudience(row.appId, filterOf(row)) }`.
- [ ] **Step 4: Run PASS; `pnpm run build`.**
- [ ] **Step 5: Commit** — `git commit -am "feat(api): audiences CRUD with live counts (per-app, tenant-scoped)"`

---

## Task D1: Targets list API

**Files:**
- Create: `server/api/devices/index.get.ts`
- Test: `test/integration/devices-list.test.ts`

**Interfaces:**
- Produces: `GET /api/devices?appId=&platform=&provider=&tag=&q=&limit=&cursor=` → `{ devices: [...], nextCursor? }`, operator-authed, masked tokens.

- [ ] **Step 1: Failing test** — seed devices across two apps; assert filtering by appId/platform/provider/tag/q(token or externalUserId substring), pagination via `limit`+`cursor` (keyset on `created_at,id`), and that tokens are masked (e.g. last 6 chars) in the response.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** with `requireSession`, Zod query parse, drizzle `and(...)` over optional filters (reuse `sql\`${tag} = ANY(${devices.tags})\``), order `desc(created_at), desc(id)`, `limit+1` for `nextCursor`. Mask: `token.slice(0,6)+'…'+token.slice(-6)`.
- [ ] **Step 4: PASS; build.**
- [ ] **Step 5: Commit** — `git commit -am "feat(api): GET /api/devices operator list (filter, paginate, masked tokens)"`

---

## Task D2: Manual add + edit-tags + delete

**Files:**
- Create: `server/api/apps/[id]/devices/manual.post.ts`, `server/api/devices/[id]/index.patch.ts`, `server/api/devices/[id]/index.delete.ts`
- Test: `test/integration/devices-manual.test.ts`

**Interfaces:**
- Produces: operator manual device add (distinct from bearer ingest), tag edit, delete.

- [ ] **Step 1: Failing tests** — manual add inserts an active device (422 empty token; 409 duplicate `(app_id, token)`); PATCH sets `tags`; DELETE removes; all `requireSession` (401 without). The existing bearer route `POST /api/apps/:id/devices` is untouched.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement.** `manual.post.ts`: Zod `{ token: min1, provider, platform, externalUserId?, tags?: string[] }`, insert with `status:'active'`, `isUniqueViolation`→409, `audit('device_add_manual')`. PATCH: `{ tags: string[] }`. DELETE by id (scope check the device's app belongs to a visible company). 
- [ ] **Step 4: PASS; build.**
- [ ] **Step 5: Commit** — `git commit -am "feat(api): operator manual device add + tag edit + delete"`

---

## Task D3: Bulk import learns `tags`

**Files:**
- Modify: `server/utils/import/devices.ts` (read it first), its column parser
- Test: `server/utils/import/devices.test.ts` (extend)

- [ ] **Step 1: Failing test** — a CSV with a `tags` column (`"vip;kl"` or `vip,kl`) imports devices with `tags: ['vip','kl']`; rows without the column import `tags: []`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3:** Add optional `tags` to the row schema; split on `[;,]`, trim, drop empties; pass to the insert. Keep all existing columns/behavior.
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(import): optional tags column for device bulk import"`

---

## Task E1: Send + schedule (single app)

**Files:**
- Modify: `server/api/campaigns/index.post.ts`, `server/api/campaigns/preview.post.ts`
- Test: `test/integration/api/campaigns-send.test.ts` (extend/create)

**Interfaces:**
- Consumes: B2 segment resolution. Produces: `POST /api/campaigns` accepts `targetType:'segment'` + optional `scheduledAt`; `scheduled` campaigns are not enqueued.

- [ ] **Step 1: Failing tests** — (a) segment send: `targetType:'segment'`, `targetValue:{filter:{tag:'vip'}}` enqueues jobs for vip devices; (b) `scheduledAt` in the future → campaign row `status:'scheduled'`, `jobsCreated:0`, no jobs rows; (c) `scheduledAt` in the past/absent → behaves as today (`queued` + enqueued).
- [ ] **Step 2: FAIL** (segment 422 today; scheduledAt unknown).
- [ ] **Step 3:** In `index.post.ts`: extend Zod `targetValue` to `{ device_ids?: string[]; audience_id?: string; filter?: { platform?: ...; provider?: ...; tag?: string } }`, add `scheduledAt: z.string().datetime().optional()`. Allow `targetType==='segment'` (remove its 422; keep `topic` rejected). After payload-size validation, if `scheduledAt` && `new Date(scheduledAt) > now`: insert `status:'scheduled', scheduledAt`, audit `campaign_scheduled`, return `{ campaignId, scheduled:true, jobsCreated:0 }`; else current path. Extend `preview.post.ts` to accept `segment` and call the previewer.
- [ ] **Step 4: PASS; build.**
- [ ] **Step 5: Commit** — `git commit -am "feat(api): segment sends + scheduledAt on POST /api/campaigns"`

---

## Task E2: Broadcast (multi-app)

**Files:**
- Create: `server/api/campaigns/broadcast.post.ts`; extract shared create logic to `server/utils/campaigns/create.ts`
- Test: `test/integration/api/campaigns-broadcast.test.ts`

**Interfaces:**
- Consumes: E1 create logic. Produces: `POST /api/campaigns/broadcast { appIds[], message, recipients, scheduledAt? }` → `{ broadcastId, campaignIds[] }`.

- [ ] **Step 1: Failing test** — two apps each with devices; broadcast `recipients:{type:'all'}` creates one campaign per app sharing one `broadcastId`, each enqueued (or scheduled). Validation: empty `appIds` → 422.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3:** Extract the single-app "validate + insert + (enqueue|schedule)" from E1 into `createCampaign(opts)` in `server/utils/campaigns/create.ts` returning `{ campaignId, scheduled, jobsCreated }`; have `index.post.ts` call it. `broadcast.post.ts`: `requireSession`, Zod `{ appIds: array(uuid).min(1), ... }`, generate one `broadcastId` (`crypto.randomUUID()`), loop apps calling `createCampaign({ ...perApp, broadcastId })`, audit `campaign_broadcast`, return ids.
- [ ] **Step 4: PASS; build.**
- [ ] **Step 5: Commit** — `git commit -am "feat(api): multi-app broadcast sharing a broadcast_id"`

---

## Task E3: Cancel scheduled

**Files:**
- Create: `server/api/campaigns/[id]/cancel.post.ts`
- Test: `test/integration/api/campaigns-cancel.test.ts`

- [ ] **Step 1: Failing test** — a `scheduled` campaign cancels → `status:'canceled'`; cancelling a `queued`/`sending` campaign → 409; unknown id → 404; `requireSession`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3:** `UPDATE campaigns SET status='canceled' WHERE id=? AND status='scheduled'`; if 0 rows, distinguish 404 (no row) vs 409 (exists but not scheduled). Audit `campaign_cancel`.
- [ ] **Step 4: PASS; build.**
- [ ] **Step 5: Commit** — `git commit -am "feat(api): cancel a scheduled campaign"`

---

## Task F1: Scheduling sweep

**Files:**
- Create: `server/utils/queue/due.ts`
- Modify: `server/utils/queue/loop.ts`
- Test: `server/utils/queue/due.test.ts`

**Interfaces:**
- Consumes: `enqueueCampaign`. Produces: `sweepDueCampaigns(): Promise<number>` (count promoted); wired as a third timer.

- [ ] **Step 1: Failing test** — insert a `scheduled` campaign with `scheduledAt` in the past (+ devices) and one in the future; `sweepDueCampaigns()` enqueues + flips only the past one to `sending`, returns 1; a second call returns 0 (idempotent). Use `runWorkerOnce` is not needed; assert `jobs` rows + campaign status.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement `due.ts`:**
```ts
import { db } from '~~/server/db/client';
import { campaigns } from '~~/server/db/schema';
import { and, eq, lte, sql } from 'drizzle-orm';
import { enqueueCampaign } from './enqueue';

export async function sweepDueCampaigns(now = new Date()): Promise<number> {
  const due = await db.execute(sql`
    SELECT id FROM campaigns
    WHERE status = 'scheduled' AND scheduled_at <= ${now}
    ORDER BY scheduled_at ASC FOR UPDATE SKIP LOCKED LIMIT 50`);
  const rows = (due.rows ?? due) as { id: string }[];
  let n = 0;
  for (const { id } of rows) {
    await enqueueCampaign(id);
    await db.update(campaigns).set({ status: 'sending' }).where(and(eq(campaigns.id, id), eq(campaigns.status, 'scheduled')));
    n++;
  }
  return n;
}
```
(If `now` default triggers the no-argless-Date rule only in workflow scripts — this is app code, `new Date()` is allowed here.) In `loop.ts` add a third timer:
```ts
import { sweepDueCampaigns } from './due';
const dueMs = opts.dueMs ?? 5000;
const dueTick = async () => { if (stopped) return; try { await sweepDueCampaigns(); } catch {} if (!stopped) setTimeout(dueTick, dueMs); };
setTimeout(dueTick, dueMs);
```
- [ ] **Step 4: PASS; build.**
- [ ] **Step 5: Commit** — `git commit -am "feat(queue): due-campaign sweep timer for scheduled sends"`

---

## Task G1: Navigation + per-app tabs

**Files:**
- Modify: `app/layouts/default.vue` (nav), `app/pages/apps/[id].vue` (tabs + quick links)
- Delete: `app/pages/apps/[id]/compose.vue`, `devices.vue`, `history.vue`; keep `credentials.vue`, `ingest-keys.vue`, `index.vue`
- Test: `app/pages/apps/app-detail.test.ts` (update), `app/layouts` has no test — add `app/pages/nav.test.ts` if a layout test harness exists; otherwise assert nav via an existing page test.

- [ ] **Step 1: Update the failing test** — in `app-detail.test.ts`, change expected tabs to `['Credentials','Ingest Keys']` and assert two quick-link buttons: "View targets" → `/targets?appId=<id>` and "Send to this app" → `/send?appId=<id>`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3:** In `default.vue` `navItems` → `[{label:'Sites',to:'/companies'},{label:'Targets',to:'/targets'},{label:'Send',to:'/send'},{label:'History',to:'/history'},{label:'Import credentials',to:'/imports/credentials'}]`. In `apps/[id].vue` reduce `tabs` to Credentials + Ingest Keys, add the two quick-link `.btn-ghost` NuxtLinks in `.page-head-actions`. Delete the three per-app pages.
- [ ] **Step 4: Run tests PASS; `pnpm run build`** (confirm no route references the deleted pages — grep `apps/.*/(compose|devices|history)`).
- [ ] **Step 5: Commit** — `git commit -am "feat(ui): top-level nav (Targets/Send/History); per-app keeps config + quick links"`

---

## Task G2: Targets page — Devices

**Files:**
- Create: `app/pages/targets/index.vue`, `app/composables/useDevices.ts`
- Test: `app/pages/targets/targets-page.test.ts`

- [ ] **Step 1: Failing component test** — mounts the page with a stubbed `/api/devices` returning two rows; asserts `data-test="targets-title"` = "Targets", a `.table` with `data-test="device-row"` per device (masked token shown), an App filter `data-test="app-filter"`, an `+ Add target` button `data-test="add-target-btn"` revealing the `.panel` form (`token-input`, `platform-select`, `provider-select`, `tags-input`, `save-target-btn`), and a "Bulk import" link to the existing import wizard. (Follow the stubbing pattern in an existing page test, e.g. `app/pages/companies/companies-page.test.ts`.)
- [ ] **Step 2: FAIL.**
- [ ] **Step 3:** Build the page using DESIGN.md classes: `.page-head` (+ Add target `.btn-primary`), filter bar, `.table-wrap/.table` (token `.mono` masked, platform, provider, tags as `.badge`, status `.badge-ok`/`.badge-danger`, date, row Edit/Delete), `.empty` state. Add `useDevices.ts` composable (`list(params)`, `manualAdd(appId, body)`, `setTags(id, tags)`, `remove(id)`) using `useCsrf().fetchToken()` + headers for mutations. Manual-add form posts to `/api/apps/:id/devices/manual`.
- [ ] **Step 4: Run tests PASS; `pnpm run build`.**
- [ ] **Step 5: Commit** — `git commit -am "feat(ui): top-level Targets page (list, manual add, filters, import link)"`

---

## Task G3: Targets page — Audiences

**Files:**
- Create: `app/pages/targets/audiences.vue`, `app/composables/useAudiences.ts`; add an Audiences tab to `app/pages/targets/index.vue` (or a `.tab-strip` switching Devices/Audiences within `index.vue` — pick the simpler; prefer a sub-route `targets/audiences.vue` reachable from a `.tab-strip` in a small `app/pages/targets.vue` parent with `<NuxtPage/>`, mirroring the app-detail wiring from G1).
- Test: `app/pages/targets/audiences-page.test.ts`

- [ ] **Step 1: Failing test** — stub `/api/apps/:id/audiences` returning two audiences with counts; assert `data-test="audience-row"` per audience showing name + filter summary + `data-test="audience-count"`, a `+ New audience` form (`audience-name`, `platform-select`, `provider-select`, `tag-input`, live `data-test="preview-count"`), and delete.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3:** Build with DESIGN.md classes; `useAudiences.ts` (`list(appId)`, `create(appId, body)`, `update(appId, aid, body)`, `remove(appId, aid)`); the form debounces and calls a count preview (reuse `/api/apps/:id/audiences` create-less count — add a tiny `GET /api/apps/:id/audiences/count?…` OR compute via `POST /api/campaigns/preview` with `targetType:'segment'`; prefer a dedicated `count` endpoint added in C1's handler set — if not present, add `server/api/apps/[id]/audiences/count.get.ts` here with a test).
- [ ] **Step 4: PASS; build.**
- [ ] **Step 5: Commit** — `git commit -am "feat(ui): Audiences tab (create/filter/live count/delete)"`

---

## Task G4: Send page

**Files:**
- Create: `app/pages/send/index.vue`, `app/composables/useSend.ts`
- Test: `app/pages/send/send-page.test.ts`

- [ ] **Step 1: Failing test** — stub apps list + `/api/campaigns/preview`; assert: app select (`data-test="app-select"`) with a `data-test="broadcast-toggle"`; recipients selector `data-test="recipients-mode"` (all/audience/specific/filter); message fields (`send-title`,`send-body`,`send-data`,`send-mode`,`send-priority`); timing `data-test="when-mode"` (now/schedule) revealing `data-test="schedule-at"`; `Preview` button populates `data-test="preview-breakdown"` (per provider/platform counts); `Send` button `data-test="send-submit"` disabled until previewed; choosing schedule changes the button label to "Schedule".
- [ ] **Step 2: FAIL.**
- [ ] **Step 3:** Build the composer (reuse the old compose form fields/validation as the basis). Single app → `POST /api/campaigns` (map recipients→targetType/targetValue, include `scheduledAt` when scheduling). Broadcast → `POST /api/campaigns/broadcast`. `useSend.ts`: `preview(appId, recipients, message)`, `send(payload)`, `broadcast(payload)`. After success route to `/history`. Use `useCsrf()`.
- [ ] **Step 4: PASS; build.**
- [ ] **Step 5: Commit** — `git commit -am "feat(ui): top-level Send page (single/broadcast, audience/filter, schedule, preview)"`

---

## Task G5: History page (top-level)

**Files:**
- Create: `app/pages/history/index.vue`, `app/composables/useHistory.ts`
- Modify: `server/api/campaigns/index.get.ts` (read first) — ensure it returns `status`, `scheduledAt`, `broadcastId`, per-status delivery counts, and accepts an `appId` filter
- Test: `app/pages/history/history-page.test.ts`, extend `test/integration/api/campaigns-list.test.ts`

- [ ] **Step 1: Failing tests** — API: list includes scheduled + canceled campaigns and groups broadcasts (same `broadcastId`); accepts `?appId=`. Page: rows show title, app, when (or "Scheduled for …"), status `.badge`, sent/failed/invalid/gave_up counts as small `.badge`s, and a Cancel `.btn-danger` for `scheduled` rows (`data-test="cancel-campaign"`).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3:** Extend the list endpoint (add fields + `appId` filter + optional broadcast grouping shape). Build the page with DESIGN.md classes + `useHistory.ts` (`list(params)`, `cancel(id)` → `POST /api/campaigns/:id/cancel`).
- [ ] **Step 4: PASS; build.**
- [ ] **Step 5: Commit** — `git commit -am "feat(ui): top-level History (scheduled/broadcast/counts, cancel)"`

---

## Task H1: Full gate + polish

**Files:** any rough edges; `.superpowers/sdd/progress.md` ledger.

- [ ] **Step 1:** Manually click the flow on the dev server (Targets add/import/audience → Send now → History; schedule → cancel) and fix any visual/UX gaps against DESIGN.md.
- [ ] **Step 2:** `pnpm run build` + full `pnpm test` → 0 failures (suite count should be the prior 483 + all new tests).
- [ ] **Step 3:** Update `.superpowers/sdd/progress.md` with the feature summary.
- [ ] **Step 4: Commit** — `git commit -am "chore: push-send-targets feature complete (build + suite green)"`

---

## Self-review notes (coverage)

- Spec §3 nav → G1. §4 data model → A1. §5 Targets (manual/bulk/list) → D1, D2, D3, G2. §6 audiences → B1, C1, G3. §7 Send (single/broadcast/recipients/schedule/preview) → B2, E1, E2, G4. §8 scheduling + cancel → E3, F1. §10 migration/route removal → A1, G1. §11 testing → folded per task. No spec requirement is left without a task; types (`AudienceFilter`, `targetValueJsonb.filter`, `createCampaign`) are defined once and reused.
