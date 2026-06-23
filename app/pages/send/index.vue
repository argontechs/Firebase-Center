<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSend } from '~/composables/useSend';

const route = useRoute();

// Fetch all apps (cross-company list for send purposes — uses a flat list)
const { data: appsRaw } = await useFetch('/api/apps/all', { default: () => [] });
const apps = computed(() => (appsRaw.value as { id: string; name: string }[]) ?? []);

// App / broadcast selection
const isBroadcast = ref(false);
const selectedAppId = ref<string>(String(route.query.appId ?? ''));
const selectedAppIds = ref<string[]>([]);

// Recipients mode: all | audience | specific | filter
const recipientsMode = ref<'all' | 'audience' | 'specific' | 'filter'>('all');
const specificTokens = ref(''); // comma-separated device IDs for 'specific'
const audienceId = ref('');
const filterPlatform = ref('');
const filterProvider = ref('');
const filterTag = ref('');

// Message fields
const sendTitle = ref('');
const sendBody = ref('');
const sendDataRaw = ref(''); // JSON string for key:value pairs
const sendMode = ref<'notification' | 'data'>('notification');
const sendPriority = ref<'high' | 'normal'>('high');

// Timing
const whenMode = ref<'now' | 'schedule'>('now');
const scheduleAt = ref('');

// Preview state
const previewing = ref(false);
const previewResult = ref<{
  byGroup: { provider: string; platform: string; count: number; credentialReady: boolean }[];
  totalBytes: number;
  withinLimit: boolean;
} | null>(null);
const previewError = ref('');

// Submit state
const submitting = ref(false);
const submitError = ref('');
const submitted = ref(false);

const sendComposable = useSend();

function buildRecipients() {
  if (recipientsMode.value === 'all') {
    return { type: 'all' as const };
  }
  if (recipientsMode.value === 'specific') {
    const device_ids = specificTokens.value
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { type: 'tokens' as const, device_ids };
  }
  if (recipientsMode.value === 'audience') {
    return { type: 'segment' as const, audience_id: audienceId.value };
  }
  // filter mode
  const filter: Record<string, string> = {};
  if (filterPlatform.value) filter.platform = filterPlatform.value;
  if (filterProvider.value) filter.provider = filterProvider.value;
  if (filterTag.value) filter.tag = filterTag.value;
  return { type: 'segment' as const, filter };
}

function buildMessage() {
  let data: Record<string, string> = {};
  if (sendDataRaw.value.trim()) {
    try {
      data = JSON.parse(sendDataRaw.value);
    } catch {
      // ignore parse errors
    }
  }
  return {
    title: sendTitle.value,
    body: sendBody.value,
    data,
    mode: sendMode.value,
    priority: sendPriority.value,
  };
}

async function runPreview() {
  previewError.value = '';
  previewResult.value = null;

  const appId = isBroadcast.value ? (selectedAppIds.value[0] ?? '') : selectedAppId.value;

  previewing.value = true;
  try {
    const result = await sendComposable.preview(appId, buildRecipients(), buildMessage());
    previewResult.value = result;
  } catch (e: unknown) {
    const err = e as { statusMessage?: string };
    previewError.value = err.statusMessage ?? 'Preview failed';
  } finally {
    previewing.value = false;
  }
}

const sendBtnLabel = computed(() => {
  if (whenMode.value === 'schedule') return 'Schedule';
  return 'Send now';
});

const canSubmit = computed(() => previewResult.value !== null && !submitting.value);

async function handleSubmit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const recipients = buildRecipients();
    const message = buildMessage();
    const scheduledAt = whenMode.value === 'schedule' && scheduleAt.value
      ? new Date(scheduleAt.value).toISOString()
      : undefined;

    if (isBroadcast.value) {
      await sendComposable.broadcast({
        appIds: selectedAppIds.value,
        message,
        recipients: recipients as any,
        scheduledAt,
      });
    } else {
      const targetValue: Record<string, unknown> = {};
      if ('device_ids' in recipients && recipients.device_ids) targetValue.device_ids = recipients.device_ids;
      if ('audience_id' in recipients && recipients.audience_id) targetValue.audience_id = recipients.audience_id;
      if ('filter' in recipients && recipients.filter) targetValue.filter = recipients.filter;

      await sendComposable.send({
        appId: selectedAppId.value,
        title: message.title,
        body: message.body,
        data: message.data,
        mode: message.mode,
        priority: message.priority,
        targetType: recipients.type,
        targetValue,
        scheduledAt,
      });
    }
    submitted.value = true;
    navigateTo('/history');
  } catch (e: unknown) {
    const err = e as { statusMessage?: string };
    submitError.value = err.statusMessage ?? 'Send failed';
  } finally {
    submitting.value = false;
  }
}

function toggleAppInBroadcast(id: string) {
  const idx = selectedAppIds.value.indexOf(id);
  if (idx === -1) {
    selectedAppIds.value = [...selectedAppIds.value, id];
  } else {
    selectedAppIds.value = selectedAppIds.value.filter((x) => x !== id);
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div class="page-head-text">
        <h1 data-test="send-title-heading" class="page-head-title">Send</h1>
        <p class="page-head-subtitle">Compose and send a push notification to one or more apps.</p>
      </div>
    </div>

    <div class="panel section-gap">
      <form class="stack" @submit.prevent="handleSubmit">

        <!-- App selection + broadcast toggle -->
        <div class="cluster" style="align-items: flex-end; gap: 16px; margin-bottom: 4px;">
          <div class="field" style="flex: 1;">
            <label class="field-label" for="app-select">App</label>
            <select
              id="app-select"
              v-model="selectedAppId"
              data-test="app-select"
              :disabled="isBroadcast"
            >
              <option value="">-- Select an app --</option>
              <option v-for="a in apps" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </div>
          <label class="cluster" style="align-items: center; gap: 6px; padding-bottom: 8px; cursor: pointer;">
            <input
              v-model="isBroadcast"
              type="checkbox"
              data-test="broadcast-toggle"
            />
            <span class="field-label" style="margin: 0;">Broadcast to multiple apps</span>
          </label>
        </div>

        <!-- Multi-app checkboxes (broadcast mode) -->
        <div v-if="isBroadcast" class="field" style="margin-bottom: 8px;">
          <p class="field-label">Select apps to broadcast to</p>
          <div class="stack" style="gap: 6px; margin-top: 4px;">
            <label
              v-for="a in apps"
              :key="a.id"
              class="cluster"
              style="align-items: center; gap: 8px; cursor: pointer;"
            >
              <input
                type="checkbox"
                :value="a.id"
                :checked="selectedAppIds.includes(a.id)"
                @change="toggleAppInBroadcast(a.id)"
              />
              <span>{{ a.name }}</span>
            </label>
          </div>
        </div>

        <!-- Recipients mode -->
        <div class="field">
          <label class="field-label" for="recipients-mode">Recipients</label>
          <select id="recipients-mode" v-model="recipientsMode" data-test="recipients-mode">
            <option value="all">All devices</option>
            <option value="audience">Saved audience</option>
            <option value="specific">Specific device IDs</option>
            <option value="filter">By filter (platform/provider/tag)</option>
          </select>
        </div>

        <!-- Specific device IDs -->
        <div v-if="recipientsMode === 'specific'" class="field">
          <label class="field-label" for="specific-tokens">Device IDs (comma or newline separated)</label>
          <textarea
            id="specific-tokens"
            v-model="specificTokens"
            rows="4"
            placeholder="One device UUID per line, or comma-separated"
            data-test="specific-tokens"
          />
        </div>

        <!-- Saved audience -->
        <div v-if="recipientsMode === 'audience'" class="field">
          <label class="field-label" for="audience-id-input">Audience ID</label>
          <input
            id="audience-id-input"
            v-model="audienceId"
            type="text"
            placeholder="Audience UUID"
            data-test="audience-id-input"
          />
        </div>

        <!-- Filter mode -->
        <div v-if="recipientsMode === 'filter'" class="cluster" style="gap: 12px; flex-wrap: wrap;">
          <div class="field" style="flex: 1; min-width: 140px;">
            <label class="field-label" for="filter-platform">Platform</label>
            <select id="filter-platform" v-model="filterPlatform" data-test="filter-platform">
              <option value="">Any</option>
              <option value="android">Android</option>
              <option value="ios">iOS</option>
              <option value="huawei">Huawei</option>
              <option value="web">Web</option>
            </select>
          </div>
          <div class="field" style="flex: 1; min-width: 140px;">
            <label class="field-label" for="filter-provider">Provider</label>
            <select id="filter-provider" v-model="filterProvider" data-test="filter-provider">
              <option value="">Any</option>
              <option value="fcm">FCM</option>
              <option value="huawei">Huawei</option>
            </select>
          </div>
          <div class="field" style="flex: 1; min-width: 140px;">
            <label class="field-label" for="filter-tag">Tag</label>
            <input
              id="filter-tag"
              v-model="filterTag"
              type="text"
              placeholder="e.g. vip"
              data-test="filter-tag"
            />
          </div>
        </div>

        <!-- Message: title -->
        <div class="field">
          <label class="field-label" for="msg-title">Title</label>
          <input
            id="msg-title"
            v-model="sendTitle"
            type="text"
            placeholder="Notification title"
            data-test="send-title"
          />
        </div>

        <!-- Message: body -->
        <div class="field">
          <label class="field-label" for="msg-body">Body</label>
          <textarea
            id="msg-body"
            v-model="sendBody"
            rows="3"
            placeholder="Notification body text"
            data-test="send-body"
          />
        </div>

        <!-- Message: data payload -->
        <div class="field">
          <label class="field-label" for="msg-data">Data payload (JSON, optional)</label>
          <textarea
            id="msg-data"
            v-model="sendDataRaw"
            rows="2"
            placeholder='{"key": "value"}'
            class="mono"
            data-test="send-data"
          />
        </div>

        <!-- Message: mode + priority -->
        <div class="cluster" style="gap: 16px; flex-wrap: wrap;">
          <div class="field" style="flex: 1; min-width: 160px;">
            <label class="field-label" for="msg-mode">Mode</label>
            <select id="msg-mode" v-model="sendMode" data-test="send-mode">
              <option value="notification">Notification</option>
              <option value="data">Data</option>
            </select>
          </div>
          <div class="field" style="flex: 1; min-width: 160px;">
            <label class="field-label" for="msg-priority">Priority</label>
            <select id="msg-priority" v-model="sendPriority" data-test="send-priority">
              <option value="high">High</option>
              <option value="normal">Normal</option>
            </select>
          </div>
        </div>

        <!-- Timing: now or schedule -->
        <div class="field">
          <label class="field-label" for="when-mode">When</label>
          <select id="when-mode" v-model="whenMode" data-test="when-mode">
            <option value="now">Send now</option>
            <option value="schedule">Schedule for later</option>
          </select>
        </div>

        <div v-if="whenMode === 'schedule'" class="field">
          <label class="field-label" for="schedule-at">Scheduled date and time</label>
          <input
            id="schedule-at"
            v-model="scheduleAt"
            type="datetime-local"
            data-test="schedule-at"
          />
        </div>

        <!-- Preview button + result -->
        <div class="cluster" style="gap: 12px; align-items: center;">
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="previewing"
            data-test="preview-btn"
            @click="runPreview"
          >{{ previewing ? 'Previewing...' : 'Preview' }}</button>
          <span v-if="previewError" class="form-error">{{ previewError }}</span>
        </div>

        <!-- Preview breakdown -->
        <div v-if="previewResult" class="preview-breakdown" data-test="preview-breakdown">
          <p class="field-label" style="margin-bottom: 8px;">Recipient breakdown</p>
          <table class="table" style="font-size: var(--t-xs);">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Platform</th>
                <th>Devices</th>
                <th>Credentials</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in previewResult.byGroup" :key="`${g.provider}-${g.platform}`">
                <td>{{ g.provider }}</td>
                <td>{{ g.platform }}</td>
                <td>{{ g.count }}</td>
                <td>
                  <span class="badge" :class="g.credentialReady ? 'badge-ok' : 'badge-danger'">
                    {{ g.credentialReady ? 'Ready' : 'Not ready' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!previewResult.withinLimit" class="form-error" style="margin-top: 8px;">
            Payload exceeds the 4 KB limit ({{ previewResult.totalBytes }} bytes). Reduce your title, body, or data.
          </p>
          <p v-else class="text-muted" style="margin-top: 8px; font-size: var(--t-xs);">
            Payload: {{ previewResult.totalBytes }} bytes (within limit)
          </p>
        </div>

        <!-- Error + submit -->
        <p v-if="submitError" class="form-error">{{ submitError }}</p>

        <div class="cluster" style="justify-content: flex-end;">
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="!canSubmit"
            data-test="send-submit"
          >{{ submitting ? 'Sending...' : sendBtnLabel }}</button>
        </div>

      </form>
    </div>
  </div>
</template>
