# Send-API — Implementation Tasks (addendum to M6)

> **Feature** (user request, "send api key"): a programmatic **send API** so the owner's own backends can trigger pushes without the UI. Each **Site** gets its own **send API key** (issued in the UI, hashed at rest, shown once, revocable). Builds on the M6 send pipeline (reuses campaign creation + `enqueueCampaign`). Build these tasks **after M6.6** (which creates campaigns).

**Conventions (verbatim from the codebase):** server-to-server imports use `~~/server/...`; client composables `~/composables/...`; mutating browser routes use `requireUser` + `assertCsrf`; the send endpoint is **bearer-key authed and CSRF-exempt** (like `POST /api/apps/:id/devices`). Mirror `server/utils/ingest-keys.ts` exactly for the key util. Commit each task on `main`.

---

## Task SA.1: `site_send_keys` schema + migration + `server/utils/send-keys.ts`

**Files:**
- Modify: `server/db/schema.ts` (add `siteSendKeys` table)
- Create: migration via `pnpm db:generate`
- Create: `server/utils/send-keys.ts`, `server/utils/send-keys.test.ts`

**Schema** (Site-scoped — `companyId`, mirrors `appIngestKeys`):
```ts
export const siteSendKeys = pgTable('site_send_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  version: integer('version').notNull().default(1),
  label: text('label'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
});
```

**`send-keys.ts`** — copy `ingest-keys.ts` verbatim, replacing `appIngestKeys`→`siteSendKeys`, `appId`→`companyId`, prefix `'bo_ik_'`→`'bo_sk_'`, and `resolveActiveKey` returns `{ id, companyId } | null`. Export: `generateSendKey`, `verifySendKey`, `issueSendKey(db, companyId, userId, label?)`, `rotateSendKey`, `revokeSendKey`, `resolveActiveSendKey(db, fullKey)`.

**Steps (TDD):**
- [ ] Write `send-keys.test.ts` — unit: `generateSendKey()` returns `bo_sk_`-prefixed key + sha256 hash + 12-char prefix; `verifySendKey` constant-time true/false; integration (real test PG): `issueSendKey` stores hash-not-plaintext; `rotateSendKey` revokes old + version+1; `revokeSendKey` idempotent 404 on already-revoked; `resolveActiveSendKey` returns row for active, null for revoked/unknown. (Mirror `ingest-keys` tests.)
- [ ] Run → fail. Implement schema + util. `pnpm db:generate` for the migration. Run → green.
- [ ] `pnpm run build` (gate). Commit: `feat(send-api): site_send_keys schema + send-keys util (mirrors ingest-keys, Site-scoped)`.

---

## Task SA.2: send-key management routes (operator UI side)

**Files:** Create `server/api/companies/[id]/send-keys/index.post.ts` (issue, show-once), `index.get.ts` (list metadata only — id/prefix/version/label/createdAt/revokedAt, **never the key**), `[kid]/revoke.post.ts`, `[kid]/rotate.post.ts`; tests.

**Auth:** `requireUser` + `assertCsrf` (operator session). Verify the company exists (404 else). Audit each action.

**Audit:** add `AuditAction` values `send_key_issue`, `send_key_rotate`, `send_key_revoke` (extend the taxonomy type/where it's defined).

**Steps (TDD):**
- [ ] Write integration tests (existing harness): issue returns `{ id, fullKey, keyPrefix, version }` once + audits `send_key_issue`; list returns metadata without `fullKey`/`keyHash`; revoke flips `revokedAt` + audits; unauthenticated → 401; missing CSRF → 403.
- [ ] Run → fail. Implement routes (reuse `send-keys.ts`). Run → green.
- [ ] `pnpm run build`. Commit: `feat(send-api): site send-key management routes (issue/list/rotate/revoke, audited)`.

---

## Task SA.3: `POST /api/v1/messages` — programmatic send endpoint

**Files:** Create `server/api/v1/messages.post.ts`, `test/integration/api/v1-messages.post.test.ts`; modify `server/middleware/auth.ts` (exempt `/api/v1/` from operator-session + CSRF, like the ingest endpoint).

**Contract:**
```
POST /api/v1/messages
Authorization: Bearer <send-key>
{ "appId": "<uuid>",
  "target": { "type": "all" } | { "type": "tokens", "deviceIds": ["<uuid>"] },
  "notification": { "title": "...", "body": "..." },
  "data": { ... }?, "mode": "notification"|"data"?, "priority": "high"|"normal"? }
→ 202 { "campaignId": "<uuid>", "jobsCreated": <n> }
```

**Flow:** `resolveActiveSendKey(db, bearer)` → `{ companyId }` (401 if unknown/revoked); **per-key + per-IP rate-limit** (reuse the generic `rateLimit()` util); load `appId`, assert `app.companyId === companyId` (403/404 else — a key cannot send for another Site's app); `validatePayloadSize` (M6.1) + Addendum-D `click_action` check; **create a `campaigns` row** (same insert M6.6's `POST /api/campaigns` does — reuse its helper if extracted, else replicate: title/body/data/mode/priority/targetType/targetValueJsonb, `createdBy = null` for API sends, a marker e.g. `source: 'api'` if the schema has room); `await enqueueCampaign(campaign.id)`; `audit({ action: 'api_send', targetType: 'campaign', targetId, meta: { companyId, appId, keyId } })`; return `202 { campaignId, jobsCreated }`. The in-process worker (M6.5) delivers asynchronously.

**Steps (TDD, mock adapters via the registry so no real HTTP):**
- [ ] Write tests: valid key + `target.all` → 202, creates campaign + jobs, audits `api_send`; unknown/revoked key → 401; key for Site A + appId under Site B → 403; oversized payload → 400; Huawei `click_action.type:1` without intent/action → 400; missing bearer → 401. Confirm the route is reached WITHOUT a CSRF token (exemption works).
- [ ] Run → fail. Implement route + middleware exemption. Run → green.
- [ ] `pnpm run build`. Commit: `feat(send-api): POST /api/v1/messages (bearer send-key, per-Site, enqueues via M6 pipeline)`.

---

## Task SA.4: send-keys UI panel (Site page)

**Files:** Create `app/pages/companies/[id]/send-keys.vue` (or a tab on the Site detail page); component test.

**UI:** list existing keys (prefix/label/version/created/revoked), an "Issue key" button that **shows the raw key once** in a copyable field with a "you won't see this again" warning, and revoke buttons. Uses `useCsrf()` (call `fetchToken()` before mutating), imports composable via `~/composables/...`.

**Steps (TDD):**
- [ ] Component test (existing `mount` + happy-dom harness): issuing shows the full key once; list shows prefix-only; revoke calls the endpoint.
- [ ] Run → fail. Implement page. Run → green.
- [ ] `pnpm run build`. Commit: `feat(send-api): site send-keys UI panel (issue show-once, list, revoke)`.

---

## Notes for the builder
- `enqueueCampaign(campaignId)` (already built, `server/utils/queue/enqueue.ts`) requires the campaign row to exist first — SA.3 must insert the campaign, then call it.
- Confirm M6.6's campaign-creation shape at build time and reuse it (extract a `createCampaign()` helper if M6.6 didn't, to avoid duplication — DRY).
- Extend the `AuditAction` taxonomy with `send_key_issue|send_key_rotate|send_key_revoke|api_send`.
- The `/api/v1/` prefix exemption in `server/middleware/auth.ts` must NOT accidentally exempt operator routes — match `/api/v1/` exactly.
