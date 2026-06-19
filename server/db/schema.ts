import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, pgEnum, unique } from 'drizzle-orm/pg-core';

// ---- Enums ----
export const userRole = pgEnum('user_role', ['admin', 'operator']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);
export const companyStatus = pgEnum('company_status', ['active', 'archived']);
export const providerEnum = pgEnum('provider', ['fcm', 'huawei']);
export const credPlatform = pgEnum('cred_platform', ['ios', 'android', 'huawei', 'web', 'any']);
export const devicePlatform = pgEnum('device_platform', ['android', 'ios', 'huawei', 'web']);
export const deviceStatus = pgEnum('device_status', ['active', 'invalid', 'unsubscribed']);
export const importStatus = pgEnum('import_status', ['processing', 'completed', 'failed']);
export const campaignMode = pgEnum('campaign_mode', ['notification', 'data']);
export const campaignPriority = pgEnum('campaign_priority', ['high', 'normal']);
export const targetType = pgEnum('target_type', ['all', 'tokens', 'segment', 'topic']);
export const providerScope = pgEnum('provider_scope', ['both', 'fcm', 'huawei']);
export const campaignStatus = pgEnum('campaign_status', ['draft', 'queued', 'sending', 'done', 'failed']);
export const deliveryStatus = pgEnum('delivery_status', ['queued', 'sent', 'failed', 'invalid', 'gave_up']);
export const jobStatus = pgEnum('job_status', ['pending', 'running', 'done', 'failed']);

// ---- Tables ----
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('operator'),
  status: userStatus('status').notNull().default('active'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const companies = pgTable('companies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  status: companyStatus('status').notNull().default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uqName: unique().on(t.name) }));

export const apps = pgTable('apps', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uqCompanyName: unique().on(t.companyId, t.name) }));

export const appCredentials = pgTable('app_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  provider: providerEnum('provider').notNull(),
  platform: credPlatform('platform').notNull(),
  label: text('label'),
  secretCiphertext: text('secret_ciphertext').notNull(),
  secretNonce: text('secret_nonce').notNull(),
  secretTag: text('secret_tag').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  metaJsonb: jsonb('meta_jsonb').notNull().default({}),
  configuredAt: timestamp('configured_at', { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
}, (t) => ({ uq: unique().on(t.appId, t.provider, t.platform) }));

export const appIngestKeys = pgTable('app_ingest_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  version: integer('version').notNull().default(1),
  label: text('label'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const devices = pgTable('devices', {
  id: uuid('id').defaultRandom().primaryKey(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  provider: providerEnum('provider').notNull(),
  platform: devicePlatform('platform').notNull(),
  token: text('token').notNull(),
  externalUserId: text('external_user_id'),
  attributesJsonb: jsonb('attributes_jsonb').notNull().default({}),
  status: deviceStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, (t) => ({ uq: unique().on(t.appId, t.token) }));

export const imports = pgTable('imports', {
  id: uuid('id').defaultRandom().primaryKey(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  filename: text('filename').notNull(),
  totalRows: integer('total_rows').notNull().default(0),
  inserted: integer('inserted').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  status: importStatus('status').notNull().default('processing'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaigns = pgTable('campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  dataJsonb: jsonb('data_jsonb').notNull().default({}),
  mode: campaignMode('mode').notNull().default('notification'),
  priority: campaignPriority('priority').notNull().default('high'),
  targetType: targetType('target_type').notNull(),
  targetValueJsonb: jsonb('target_value_jsonb').notNull().default({}),
  providerScope: providerScope('provider_scope').notNull().default('both'),
  status: campaignStatus('status').notNull().default('draft'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deliveries = pgTable('deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id),
  deviceId: uuid('device_id').references(() => devices.id),
  provider: providerEnum('provider').notNull(),
  platform: devicePlatform('platform').notNull(),
  token: text('token').notNull(),
  status: deliveryStatus('status').notNull().default('queued'),
  disposition: text('disposition'),
  errorCode: text('error_code'),
  responseMeta: jsonb('response_meta'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
});

export const jobs = pgTable('jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(),
  payloadJsonb: jsonb('payload_jsonb').notNull(),
  status: jobStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  idempotencyKey: text('idempotency_key').notNull(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique().on(t.type, t.idempotencyKey) }));

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metaJsonb: jsonb('meta_jsonb'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const siteSendKeys = pgTable('site_send_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  version: integer('version').notNull().default(1),
  label: text('label'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// ---- M1-only extension (NOT in the Shared Contracts Registry) ----
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),                  // 256-bit random, base64url
  userId: uuid('user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  absoluteExpiry: timestamp('absolute_expiry', { withTimezone: true }).notNull(),
});
