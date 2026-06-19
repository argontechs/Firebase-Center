<script setup lang="ts">
import { ref, computed } from 'vue';

defineOptions({ name: 'DevicesPage' });

const route = useRoute();
const appId = computed(() => String(route.params.id));
// useCsrf is auto-imported by Nuxt; in tests it is stubbed as a global via vi.stubGlobal.
const { token } = useCsrf();

type Step = 'upload' | 'map' | 'results';
const step = ref<Step>('upload');
const file = ref<File | null>(null);
const headers = ref<string[]>([]);
const mapping = ref({ token: '', provider: '', platform: '', externalUserId: '' });
const defaults = ref({ provider: '', platform: '' });
const result = ref<{ total: number; inserted: number; updated: number; failed: number } | null>(null);

async function onFileChosen(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null;
  file.value = f;
  if (!f) return;
  const text = await f.text();
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  headers.value = firstLine.split(',').map((h) => h.trim());
  step.value = 'map';
}

async function runImport() {
  if (!file.value) return;
  const fd = new FormData();
  fd.set('file', file.value, file.value.name);
  fd.set('format', file.value.name.endsWith('.json') ? 'json' : 'csv');
  fd.set('mapping', JSON.stringify(mapping.value));
  if (defaults.value.provider) fd.set('defaultProvider', defaults.value.provider);
  if (defaults.value.platform) fd.set('defaultPlatform', defaults.value.platform);
  result.value = await $fetch(`/api/apps/${appId.value}/imports`, {
    method: 'POST',
    body: fd,
    headers: { 'x-csrf-token': token.value },
  });
  step.value = 'results';
}
</script>

<template>
  <section>
    <div v-if="step === 'upload'" data-testid="step-upload">
      <h2>Import devices</h2>
      <input
        type="file"
        accept=".csv,.json"
        data-testid="file-input"
        @change="onFileChosen"
      />
    </div>

    <div v-else-if="step === 'map'" data-testid="step-map">
      <h2>Map columns</h2>
      <label>
        Token column
        <select v-model="mapping.token" data-testid="map-token">
          <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
        </select>
      </label>
      <label>
        Provider column
        <select v-model="mapping.provider">
          <option value="">(use default)</option>
          <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
        </select>
      </label>
      <label>
        Platform column
        <select v-model="mapping.platform">
          <option value="">(use default)</option>
          <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
        </select>
      </label>
      <label>
        Default provider
        <input v-model="defaults.provider" placeholder="fcm | huawei" />
      </label>
      <label>
        Default platform
        <input v-model="defaults.platform" placeholder="android | ios | web | huawei" />
      </label>
      <button data-testid="run-import" @click="runImport">Import</button>
    </div>

    <div v-else data-testid="step-results">
      <h2>Import complete</h2>
      <p data-testid="result-inserted">Inserted: {{ result?.inserted }}</p>
      <p data-testid="result-updated">Updated: {{ result?.updated }}</p>
      <p data-testid="result-failed">Failed (rejected): {{ result?.failed }}</p>
      <button @click="step = 'upload'">Import more</button>
    </div>
  </section>
</template>
