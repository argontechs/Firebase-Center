<script setup lang="ts">
import { ref, computed } from 'vue';

defineOptions({ name: 'ComposePage' });

const route = useRoute();
const router = useRouter();
const appId = computed(() => String(route.params.id));

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

function parsedData(): Record<string, string> {
  try { return JSON.parse(dataText.value || '{}'); } catch { return {}; }
}
function targetValue() {
  return targetType.value === 'tokens'
    ? { device_ids: deviceIdsText.value.split(',').map((s) => s.trim()).filter(Boolean) }
    : {};
}

async function preview() {
  const res = await $fetch<{ byGroup: GroupPreview[]; totalBytes: number; withinLimit: boolean }>(
    '/api/campaigns/preview',
    {
      method: 'POST',
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
}

const canSend = computed(() => previewed.value && withinLimit.value && !sending.value);

async function send() {
  if (!canSend.value) return;
  sending.value = true;
  try {
    const res = await $fetch<{ campaignId: string }>('/api/campaigns', {
      method: 'POST',
      body: {
        appId: appId.value, title: title.value, body: body.value, data: parsedData(),
        mode: mode.value, priority: priority.value,
        targetType: targetType.value, targetValue: targetValue(), providerScope: 'both',
      },
    });
    await router.push(`/apps/${appId.value}/history?campaign=${res.campaignId}`);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <section class="compose">
    <h1>Compose</h1>
    <label>Title <input v-model="title" data-test="title" /></label>
    <label>Body <textarea v-model="body" data-test="body" /></label>
    <label>Data (JSON) <textarea v-model="dataText" data-test="data" /></label>

    <label>Mode
      <select v-model="mode" data-test="mode">
        <option value="notification">notification</option>
        <option value="data">data</option>
      </select>
    </label>
    <label>Priority
      <select v-model="priority" data-test="priority">
        <option value="high">high</option>
        <option value="normal">normal</option>
      </select>
    </label>
    <label>Target
      <select v-model="targetType" data-test="target">
        <option value="all">all devices</option>
        <option value="tokens">specific devices</option>
      </select>
    </label>
    <label v-if="targetType === 'tokens'">Device IDs (comma-separated)
      <input v-model="deviceIdsText" data-test="device-ids" />
    </label>

    <button data-test="preview-btn" @click="preview">Preview recipients</button>

    <div v-if="previewed" class="preview">
      <ul>
        <li
          v-for="g in byGroup"
          :key="`${g.provider}-${g.platform}`"
          :data-test="`group-${g.provider}-${g.platform}`"
          :class="{ 'not-ready': !g.ready }"
        >
          {{ g.provider }} / {{ g.platform }} — {{ g.count }} device(s)
          <span v-if="!g.ready" class="warn">credential not ready</span>
        </li>
      </ul>
      <p data-test="within-limit">
        Payload {{ totalBytes }} bytes — {{ withinLimit ? 'OK (≤ 4096)' : 'TOO LARGE (&gt; 4096)' }}
      </p>
    </div>

    <button data-test="send-btn" :disabled="!canSend" @click="send">Send</button>
  </section>
</template>
