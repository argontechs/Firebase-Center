<script setup lang="ts">
import { ref, computed } from 'vue';

defineOptions({ name: 'ComposePage' });

const route = useRoute();
const router = useRouter();
const appId = computed(() => String(route.params.id));
const csrf = useCsrf();

const title = ref('');
const body = ref('');
const dataText = ref('{}');
const mode = ref<'notification' | 'data'>('notification');
const priority = ref<'high' | 'normal'>('high');
const targetType = ref<'all' | 'tokens'>('all');
const deviceIdsText = ref('');

interface GroupPreview { provider: string; platform: string; count: number; ready: boolean }
const byGroup = ref<GroupPreview[]>([]);
const totalBytes = ref(0);
const withinLimit = ref(true);
const previewed = ref(false);
const sending = ref(false);
const error = ref<string | null>(null);

function parsedData(): Record<string, string> {
  try { return JSON.parse(dataText.value || '{}'); } catch { return {}; }
}
function targetValue() {
  return targetType.value === 'tokens'
    ? { device_ids: deviceIdsText.value.split(',').map((s) => s.trim()).filter(Boolean) }
    : {};
}

async function preview() {
  error.value = null;
  try {
    await csrf.fetchToken();
    const res = await $fetch<{ byGroup: GroupPreview[]; totalBytes: number; withinLimit: boolean }>(
      '/api/campaigns/preview',
      {
        method: 'POST',
        headers: csrf.headers(),
        body: {
          appId: appId.value, mode: mode.value, priority: priority.value,
          targetType: targetType.value, targetValue: targetValue(), providerScope: 'both',
          title: title.value, body: body.value, data: parsedData(),
        },
      },
    );
    byGroup.value = res.byGroup;
    totalBytes.value = res.totalBytes;
    withinLimit.value = res.withinLimit;
    previewed.value = true;
  } catch (e: any) {
    error.value = e?.data?.message ?? e?.message ?? 'Preview failed. Please try again.';
  }
}

const canSend = computed(() => previewed.value && withinLimit.value && !sending.value);

async function send() {
  if (!canSend.value) return;
  sending.value = true;
  error.value = null;
  try {
    await csrf.fetchToken();
    const res = await $fetch<{ campaignId: string }>('/api/campaigns', {
      method: 'POST',
      headers: csrf.headers(),
      body: {
        appId: appId.value, title: title.value, body: body.value, data: parsedData(),
        mode: mode.value, priority: priority.value,
        targetType: targetType.value, targetValue: targetValue(), providerScope: 'both',
      },
    });
    await router.push(`/apps/${appId.value}/history?campaign=${res.campaignId}`);
  } catch (e: any) {
    error.value = e?.data?.message ?? e?.message ?? 'Send failed. Please try again.';
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="compose-page">
    <div class="page-head">
      <div class="page-head-text">
        <h2 class="page-head-title">Compose</h2>
        <p class="page-head-subtitle">Send a push notification or data message to this app's devices.</p>
      </div>
    </div>

    <div class="panel compose-panel">
      <!-- Message content -->
      <div class="stack">
        <div class="field">
          <label class="field-label" for="compose-title">Title</label>
          <input
            id="compose-title"
            v-model="title"
            data-test="title"
            type="text"
            placeholder="Notification title"
          />
        </div>

        <div class="field">
          <label class="field-label" for="compose-body">Body</label>
          <textarea
            id="compose-body"
            v-model="body"
            data-test="body"
            placeholder="Notification body text"
          ></textarea>
        </div>

        <div class="field field-mono">
          <label class="field-label" for="compose-data">Data (JSON)</label>
          <textarea
            id="compose-data"
            v-model="dataText"
            data-test="data"
            placeholder="{}"
            style="min-height: 72px;"
          ></textarea>
        </div>
      </div>

      <!-- Mode, priority, target row -->
      <div class="form-row section-gap">
        <div class="field">
          <label class="field-label" for="compose-mode">Mode</label>
          <select id="compose-mode" v-model="mode" data-test="mode">
            <option value="notification">notification</option>
            <option value="data">data</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="compose-priority">Priority</label>
          <select id="compose-priority" v-model="priority" data-test="priority">
            <option value="high">high</option>
            <option value="normal">normal</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="compose-target">Target</label>
          <select id="compose-target" v-model="targetType" data-test="target">
            <option value="all">all devices</option>
            <option value="tokens">specific devices</option>
          </select>
        </div>
      </div>

      <div v-if="targetType === 'tokens'" class="field row-gap">
        <label class="field-label" for="compose-device-ids">Device IDs (comma-separated)</label>
        <input
          id="compose-device-ids"
          v-model="deviceIdsText"
          data-test="device-ids"
          type="text"
          placeholder="token1, token2, token3"
          class="mono"
        />
      </div>

      <!-- Preview action -->
      <div class="compose-actions row-gap">
        <button class="btn btn-ghost" data-test="preview-btn" @click="preview">
          Preview recipients
        </button>
      </div>

      <!-- Recipient preview -->
      <div v-if="previewed" class="compose-preview section-gap">
        <p class="compose-preview-label text-xs font-medium text-muted" style="margin-bottom: 10px;">
          Recipients by provider / platform
        </p>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Platform</th>
                <th>Devices</th>
                <th>Readiness</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="g in byGroup"
                :key="`${g.provider}-${g.platform}`"
                :data-test="`group-${g.provider}-${g.platform}`"
                :class="{ 'not-ready': !g.ready }"
              >
                <td class="mono">{{ g.provider }}</td>
                <td class="mono">{{ g.platform }}</td>
                <td>{{ g.count }}</td>
                <td>
                  <span v-if="g.ready" class="badge badge-ok">ready</span>
                  <span v-else class="badge badge-warn">credential not ready</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p
          data-test="within-limit"
          class="compose-payload-note text-xs"
          :class="withinLimit ? 'text-muted' : 'text-danger'"
          style="margin-top: 10px;"
        >
          Payload {{ totalBytes }} bytes - {{ withinLimit ? 'OK (≤ 4096)' : 'TOO LARGE (> 4096)' }}
        </p>
      </div>

      <!-- Error -->
      <p v-if="error" data-test="error-msg" role="alert" class="text-danger text-sm" style="margin-top: 12px;">
        {{ error }}
      </p>

      <!-- Send -->
      <div class="compose-send-row section-gap">
        <button
          class="btn btn-primary compose-send-btn"
          data-test="send-btn"
          :disabled="!canSend"
          @click="send"
        >
          {{ sending ? 'Sending...' : 'Send' }}
        </button>
        <span v-if="!previewed" class="text-xs text-faint">Preview recipients first to enable Send.</span>
        <span v-else-if="!withinLimit" class="text-xs text-danger">Payload too large to send.</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compose-page {
  max-width: 680px;
}

.compose-panel {
  display: flex;
  flex-direction: column;
}

.compose-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.compose-preview-label {
  font-weight: 550;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.compose-send-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 4px;
}

.compose-send-btn {
  padding: 10px 28px;
  font-size: var(--t-base);
}
</style>
