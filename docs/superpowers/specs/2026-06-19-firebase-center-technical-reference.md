# Push Back-Office — Technical Reference

> Companion to `2026-06-19-firebase-center-design.md`. Fact-checked (multi-agent, official-docs-first, June 2026) reference for the provider mechanics the design depends on. Update this doc if provider APIs change.

A practical reference for building a self-hosted, single-tenant back-office that sends push notifications through **Firebase Cloud Messaging (FCM) HTTP v1** and **Huawei Push Kit (HMS Core / HCM)**. Both providers are OAuth2-based with short-lived (~1 hour) bearer tokens; the differences are in the *stored* credential, the payload shape, and the multicast/error semantics.

---

## 1. Provider Auth Flows (Side by Side)

Both providers authenticate server-to-server and send a short-lived `Authorization: Bearer <access_token>` on every send. Neither long-lived credential is ever transmitted to the send endpoint — it is only used locally to mint/refresh the token.

| Aspect | **FCM HTTP v1** | **Huawei Push Kit** |
|---|---|---|
| OAuth2 grant | Service-account / JWT-bearer assertion | `client_credentials` (client password mode) |
| Long-lived secret | Service account JSON (RSA `private_key`) | App ID + App Secret (`client_id` / `client_secret`) |
| Token endpoint | `https://oauth2.googleapis.com/token` (the JSON `token_uri`) | `https://oauth-login.cloud.huawei.com/oauth2/v3/token` |
| Mint mechanics | Sign a JWT with `private_key` (`iss`/`sub` = `client_email`), request scope, exchange for token | POST form body `grant_type=client_credentials&client_id={App ID}&client_secret={App Secret}` |
| Content-Type (token req) | Handled by Google Auth library | `application/x-www-form-urlencoded` |
| Scope | `https://www.googleapis.com/auth/firebase.messaging` (exact) | n/a (app-level access, no scope string) |
| Token TTL | ~1 hour (`expires_in: 3600`) | 1 hour (`expires_in: 3600`) |
| Token type | Bearer | Bearer |
| Implementation note | Prefer the Firebase Admin SDK or a Google Auth library — they sign the JWT, scope it, exchange, and auto-refresh. Do not hand-roll the JWT. | Plain HTTPS form POST; cache and reuse the returned `access_token`. |

**FCM flow:** `service-account.json` → Google Auth library signs a JWT with `private_key` → POST to `oauth2.googleapis.com/token` with scope `firebase.messaging` → receive `access_token` (1h) → `Authorization: Bearer <token>` on each send.

**Huawei flow:** `App ID` + `App Secret` → POST `client_credentials` form to `oauth-login.cloud.huawei.com/oauth2/v3/token` → receive `{ access_token, token_type: "Bearer", expires_in: 3600 }` → `Authorization: Bearer <token>` on each send.

> **Legacy is dead (two distinct deprecations — do not conflate them).**
> 1. **Legacy HTTP/XMPP send API + static "Server key"** (`Authorization: key=...`, `fcm.googleapis.com/fcm/send`): deprecated **2023-06-20**, **removed June 20, 2024**. HTTP v1 with OAuth2 is the only supported send path. Any tutorial mentioning a "Server key" is outdated.
> 2. **The old HTTP batch endpoint** (`fcm.googleapis.com/batch`) **and the Admin SDK methods that used it** (`sendAll()` / `sendMulticast()`): deprecated **2023-06-21**, removed **June 2024**. Use `sendEach()` / `sendEachForMulticast()` instead (see §3 — they do *not* batch over the wire).

---

## 2. What a "Profile" Must Store Per Provider

> **Direct answer to the "2 OAuth" question:** Yes — *both* providers are OAuth2 with ~1-hour Bearer tokens, but the long-lived credential you persist in a profile is a **different shape** for each. Never store the short-lived access token as the profile credential; store the long-lived secret and mint tokens at runtime.

> **Provider-scoped tokens (unified-store rule):** FCM tokens and HMS tokens are **not interchangeable**. A unified token store **must record which provider issued each token** (and ideally which profile), because the same device string is meaningless to the other vendor and routing a token to the wrong adapter produces spurious invalid-token errors. Make `provider` (and `app_id`) part of the token's primary identity, not an afterthought.

### FCM profile

Store the **entire service account JSON blob** (Firebase Console → Project Settings → Service accounts → Generate new private key).

| Field | Role | Sensitivity |
|---|---|---|
| `project_id` | Goes in the send endpoint URL path | Non-secret (displayable metadata) |
| `client_email` | JWT issuer (`iss`) and subject (`sub`) | Identifying — protect |
| `private_key` | RSA key that signs the JWT | **The secret.** Cannot be recovered from Google; leaking it compromises the project |
| `private_key_id`, `client_id`, `token_uri`, etc. | Handled by the auth library | Identifying — keep with the blob |

Persist the whole file as one encrypted JSON blob. Treat the file as a unit; the single most sensitive field is `private_key`.

> **Platform credentials are NOT in the service account (common operator gap).** The service account JSON authorizes *sending*, but FCM still needs platform-specific delivery credentials configured **in the Firebase project**:
> - **iOS (APNs):** upload an **APNs auth key (`.p8`, recommended)** under Firebase Console → Project Settings → Cloud Messaging → Apple app config. If missing/expired, iOS sends fail with `401 THIRD_PARTY_AUTH_ERROR`.
> - **Web (WebPush/VAPID):** generate/upload the **Web Push certificate (VAPID key pair)** under the same Cloud Messaging settings.
>
> Treat "APNs key uploaded" and "VAPID key present" as part of profile *readiness*, even though they aren't fields you store.

### Huawei profile

| Field | Role | Sensitivity |
|---|---|---|
| **App ID** | OAuth `client_id` **and** the `{app_id}` path segment of the v1 send URL | Identifier (low sensitivity; displayable metadata) |
| **App Secret** | OAuth `client_secret` | **The secret** — encrypt at rest |
| **Project ID** | Needed for the v2 (`/v2/{projectId}/...`) project-scoped endpoint — **mandatory** for newer AGC projects | Identifier |

> **Huawei gotcha (App ID overloaded):** App ID is the OAuth `client_id` *and* the `{app_id}` path segment in the send URL. App Secret == `client_secret`. Found in AppGallery Connect → My Projects → *project* → Project settings, after enabling Push Kit.
>
> **Credential-source trap:** Push Kit needs the **App-level** App ID/App Secret (tied to the app under Project settings), *not* an account-level OAuth client. Using the wrong pair produces OAuth failures (`80200001/3`) that look like a code bug but are a credential-source mistake.

**Not a profile credential:** device push tokens are runtime data supplied by clients, not stored provider secrets (and are provider-scoped — see the unified-store rule above).

---

## 3. Send APIs & Payload Shapes

### FCM HTTP v1

```
POST https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
```

```json
{
  "message": {
    "token": "<REGISTRATION_TOKEN>",
    "notification": { "title": "...", "body": "...", "image": "..." },
    "data": { "key": "value" },
    "android": { "ttl": "86400s", "priority": "high", "notification": { "channel_id": "..." } },
    "apns":    { "headers": { "apns-priority": "10" }, "payload": { "aps": { "badge": 1, "sound": "default" } } },
    "webpush": { "headers": { "TTL": "..." }, "fcm_options": { "link": "..." } },
    "fcm_options": { "analytics_label": "..." }
  }
}
```

- **Targeting:** exactly one of `token`, `topic`, or `condition` (mutually exclusive).
- **`notification`** is a cross-platform template auto-displayed by the SDK. **`data`** is a **flat string→string map** handled by app code — *no nested JSON* (serialize nested objects to strings).
- **`notification` vs `data` — the #1 background-delivery bug.** A message with a `notification` block is rendered by the system tray when backgrounded and `onMessageReceived` is **not** called; a **data-only** message is always delivered to the app but you render it yourself. **Design rule:** data-only when the app must handle it in the background; `notification` for plain tray display. Document the mode per campaign.
- **Message size:** **4096 bytes (4 KB)** data payload (topic messages **2 KB**).
- **Topics:** name matches `[a-zA-Z0-9-_.~%]+`; no `/topics/` prefix. **Conditions:** boolean over topics, **max 5 topics**.
- **Success:** `200 { "name": "projects/{project}/messages/{message_id}" }` — capture `message_id` for idempotency.
- **Multicast:** there is **no** multi-token field. `sendEach()` / `sendEachForMulticast()` accept arrays of up to **500** but **fan out to one HTTP/2 request per token internally** (no over-the-wire batch). The removed `/batch`, `sendAll()`, `sendMulticast()` are gone.

### Huawei Push Kit

```
POST https://push-api.cloud.huawei.com/v1/{app_id}/messages:send
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
```

```json
{
  "validate_only": false,
  "message": {
    "notification": { "title": "...", "body": "...", "image": "..." },
    "data": "{\"k\":\"v\"}",
    "android": {
      "urgency": "HIGH", "category": "...", "ttl": "86400s",
      "notification": { "click_action": { "type": 1, "action": "..." }, "channel_id": "...", "importance": "NORMAL" }
    },
    "token": ["<TOKEN_1>", "<TOKEN_2>"]
  }
}
```

- **Targeting:** exactly one of `token` (string **array**, up to **1000**), `topic` (string), or `condition` (string).
- **`data` is a single JSON-encoded STRING**, not a key/value map (the #1 payload difference vs FCM — `JSON.stringify` your key/values).
- **`validate_only: true`** is a dry-run that **still requires a valid token, hits the live endpoint, consumes quota, and delivers nothing**. Server-side pre-flight only; never a client path, never on for real sends.
- **`click_action.type`:** `1` = open custom app page (**must set `intent`/`action`** or you get `80100003`); `2` = open URL; `3` = start app.
- **`urgency` vs `importance`:** `android.urgency` (`HIGH`/`NORMAL`) controls **delivery**; `android.notification.importance` controls **display**. Distinct fields.
- **`category` (self-classification):** required for high-priority/marketing; omitting/misusing it gets rate-limited or returns `80300011`.
- **Conditions** use Huawei's own syntax (incompatible with FCM): `CTopic("TopicA") && (CTopic("TopicB") || !CTopic("TopicD"))`.
- **Body limit:** **4096 bytes** excluding the token list.
- **Response:** `200 { "code": "...", "msg": "...", "requestId": "..." }` — **HTTP 200 even on failure**; you must inspect `code`.
- **v1 vs v2 — support BOTH:** v1 app-scoped (`/v1/{app_id}/...`, App-level App ID/Secret); v2 project-scoped (`/v2/{projectId}/...`, Project ID + project-level credential). Newer AGC projects may **only** expose v2 — detect and support both.

> **Avoid deprecated hosts** from old Huawei demos: use `oauth-login.cloud.huawei.com` (token) and `push-api.cloud.huawei.com` (send), **not** `login.cloud.huawei.com` / `api.push.hicloud.com`.

---

## 4. Token Caching & Lifetimes

| | FCM | Huawei |
|---|---|---|
| Access token TTL | ~1 hour | 1 hour |
| Refresh | Auto (Google Auth library / Admin SDK) | Manual — re-POST `client_credentials` |
| Cache | The **token**, in memory | The **token**, in memory |

- Cache the access token in memory; refresh **proactively** (< 5 min remaining), not reactively after a 401.
- Decrypt the long-lived stored credential **only** long enough to mint/refresh a token, then hold only the token in memory.

---

## 5. Send Semantics, Batch Limits, Invalid-Token Handling

| Concern | **FCM HTTP v1** | **Huawei Push Kit** |
|---|---|---|
| Tokens per HTTP call | **1** | **Up to 1000** in `message.token[]` (`80300010` over) |
| "Multicast" model | Client-side array ≤ 500 fans out to 1 req/token | Native multi-token in one request |
| Body size limit | **4 KB** (topic 2 KB) | ≤ 4096 bytes excluding token list (`80300008` over) |
| Partial failure | SDK `BatchResponse.responses[]` (ordered) | `code=80100000`, failed tokens in **`illegal_tokens`** |
| HTTP status on failure | Non-2xx with error body | **Always 200** — inspect `code` |

### FCM error codes & actions

| HTTP / errorCode | Action |
|---|---|
| `404 UNREGISTERED` | **Remove token** |
| `400 INVALID_ARGUMENT` | Fix request; delete token only if payload is certainly valid |
| `403 SENDER_ID_MISMATCH` | Wrong sender; no retry |
| `429 QUOTA_EXCEEDED` / `503 UNAVAILABLE` / `500 INTERNAL` | Retry with backoff; honor `Retry-After` |
| `401 THIRD_PARTY_AUTH_ERROR` | **APNs/WebPush credential missing/expired** in the Firebase project — fix `.p8`/VAPID; no retry until fixed |

- **Token expiry is device-level:** FCM tokens expire after **270 days** of **device** inactivity (not your app's last-open). Cleanup must be **event-driven** (act on send-time `UNREGISTERED`), not last-seen timestamps.
- **No server-side idempotency key:** dedupe at the queue/worker layer (key = campaign-id + token) and record the returned `message_id` so a confirmed send is never re-enqueued.

### Huawei response/error codes

| Code | Meaning / Action |
|---|---|
| `80000000` | Success |
| `80100000` | **Partial** success — prune tokens in **`illegal_tokens`** |
| `80300007` | **All** tokens invalid — remove all |
| `80300002` | **All tokens invalid** (token-validity, same class as `80300007`) — remove. *Not* a permission error. |
| `80100003` | Incorrect message structure (e.g. `click_action.type:1` with no `intent`/`action`) |
| `80200001` / `80200003` | OAuth auth error / token expired (re-mint) |
| `80300008` | Body too large (> 4096 bytes) |
| `80300010` | Token count exceeds 1000 |
| `80300011` | **Not authorized for high-priority** — fix `category`/priority authorization (not a transient retry) |
| `81000001` | Internal error (retry with backoff) |

- **Invalid-token cleanup:** `80100000` → prune `illegal_tokens`; `80300007`/`80300002` → remove all tokens in that request (Huawei's equivalent of FCM `UNREGISTERED`).
- **Huawei throttling:** self-impose QPS pacing with exponential backoff + jitter; cap concurrency per app (Huawei does not always hand you a `Retry-After`).

> **Shared-abstraction implication:** a cross-vendor batcher must chunk to the per-vendor limit (FCM 500 array / Huawei 1000), and must read provider *body* codes (Huawei) as well as HTTP status (FCM).

---

## 6. Credential-at-Rest Security Recommendations

1. **Server-only secrets** — never in a client, never returned to the browser after save.
2. **Encrypt at rest with AES-256-GCM** — fresh random 12-byte nonce per encryption; store nonce + auth tag with the ciphertext. **Never reuse a (key, nonce) pair.**
3. **Separate key from data.** KMS / envelope encryption is the real recommendation (app holds no long-lived master key). An **env-var master key is a pragmatic floor only** — operational, not cryptographic, separation (a single RCE compromises both). Plan to move to KMS.
4. **Write-only UI fields** — accept the secret on write; on read return only metadata (`configured: true`, `project_id`/App ID, fingerprint/last-4). Never serialize the decrypted `private_key`/App Secret back.
5. **Rotation, two layers** — master-key (key-version column → decrypt-then-re-encrypt) and provider-credential (rotate SA key / regenerate App Secret). Master-key rotation does not remediate a leaked provider credential.
6. **Audit logging** — every send (who/when/provider/profile/target/result) and every credential change.
7. **Never log secrets** — not the SA JSON, App Secret, decrypted key, **or the minted bearer token**. Scrub provider request/response dumps.
8. **Defense in depth** — TLS, volume encryption under the DB, least-privilege DB/OS accounts, a dedicated least-privilege Google service account per app (`firebase.messaging` only), secret scanning, master key delivered at boot.

> If a credential ever hits git, treat it as compromised and rotate immediately.

---

## 7. Prior-Art Architecture Patterns to Borrow

- **gorush** (multi-provider gateway): single send endpoint with a platform discriminator; **async queue + worker pool** decouples accept-from-API from deliver-to-provider.
- **Novu**: a typed **`IPushProvider` interface** (the clean adapter seam); per-environment **integration credential-profiles** allowing **multiple integrations of the same provider**; documented pitfalls (token invalidation, plaintext credentials, leaky abstractions).

**Adopt:**
- **Provider/adapter pattern:** a `PushProvider` interface (`mintToken`, `send(batch)`, `normalizeErrors`) with `FcmAdapter` and `HuaweiAdapter`. Keep vendor quirks (Huawei `data`-as-string, FCM 500-array fanout, incompatible condition syntax, `urgency`-vs-`importance`) *inside* the adapter.
- **Profile-per-app model:** each profile = one provider credential set + non-secret metadata, encrypted at rest, multiple profiles per provider allowed. Tokens are provider-scoped.
- **Unified composer:** a vendor-neutral message model (title/body/image/data/targets/priority) each adapter renders into the wire shape — translating the common `data` map into Huawei's JSON-string and FCM's flat map, chunking to per-vendor limits, **normalizing priority across both axes**.
- **Async queue + workers** for fanout, backoff/retry (honor `Retry-After` for FCM, self-paced QPS for Huawei), idempotent retry, and event-driven token cleanup.

> **Priority/urgency normalization pitfall:** FCM folds delivery+wake into a single `android.priority`; Huawei splits into `android.urgency` (delivery) **and** `android.notification.importance` (display), plus the `category` gate. Model both axes in the neutral message; let each adapter project them.

---

## 8. Implications for Our Design

- **Two adapters, one composer** — isolate every FCM/Huawei difference behind a `PushProvider` interface; the composer and credential layers never branch on vendor.
- **Profile stores the long-lived secret, never the token** — FCM = full SA JSON (secret = `private_key`); Huawei = App ID + App Secret (+ Project ID if v2). Surface `project_id`/App ID as metadata; everything else write-only. Verify project-level readiness (APNs `.p8`/VAPID for FCM; Push Kit enabled + App-level pair for Huawei).
- **Tokens are provider-scoped** — store `provider` and `app_id` with every token.
- **Centralized token cache with proactive refresh** (< 5 min before 3600s expiry); decrypt the stored secret only to mint/refresh; never log/return the token.
- **Encrypt credentials at rest with AES-256-GCM + separated key** (env-var floor → KMS goal); key-version column for rotation; write-only secret fields in the UI.
- **Normalize errors into a common per-token disposition:** `DELETE_TOKEN` (FCM `UNREGISTERED`; Huawei `illegal_tokens`/`80300007`/`80300002`); `RETRY_BACKOFF` (FCM `429`/`503`/`500`; Huawei `81000001`/5xx/QPS); `FIX_REQUEST` (FCM `INVALID_ARGUMENT`; Huawei `80100003`/`80300011`); `REAUTH` (Huawei `80200001/3`); `FIX_CREDENTIALS` (FCM `401 THIRD_PARTY_AUTH_ERROR`).
- **Read body codes, not just HTTP status** — Huawei returns HTTP 200 on failure.
- **Chunk to per-vendor limits** — Huawei ≤ 1000/request; FCM ≤ 500 arrays fanning out to 1 req/token (cap concurrency ~100). For FCM audiences > ~10k prefer topics. Never use removed `/batch`/`sendAll`/`sendMulticast`.
- **Idempotent retry** — dedupe at the worker layer; persist `message_id`/`requestId`.
- **Event-driven token hygiene** — prune on send-time errors, not last-seen timestamps.
- **Validate payloads before send** — 4 KB cap (FCM topics 2 KB); reject Huawei `click_action.type:1` without `intent`/`action`; require Huawei `category` for high-priority.
- **Decide notification-vs-data mode per campaign** — document it to avoid "works in foreground, silent in background" bugs.
- **Audit every send and config change; never log secrets or tokens.**
- **Use vendor SDKs where they help** — Firebase Admin SDK handles FCM JWT signing/scoping/refresh/`sendEach*`; for Huawei a thin REST client suffices (`github.com/HMS-Core` server demos are the most reliable code reference).
