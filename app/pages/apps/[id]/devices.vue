<script setup lang="ts">
import { ref, computed } from 'vue';

defineOptions({ name: 'DevicesPage' });

const route = useRoute();
const appId = computed(() => String(route.params.id));
// useCsrf is auto-imported by Nuxt; in tests it is stubbed as a global via vi.stubGlobal.
// fetchToken() is called before the first mutating fetch to match the project CSRF convention
// (same pattern as login.vue and useCredentialImport.ts).
const csrf = useCsrf();

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
  await csrf.fetchToken();
  const fd = new FormData();
  fd.set('file', file.value, file.value.name);
  fd.set('format', file.value.name.endsWith('.json') ? 'json' : 'csv');
  fd.set('mapping', JSON.stringify(mapping.value));
  if (defaults.value.provider) fd.set('defaultProvider', defaults.value.provider);
  if (defaults.value.platform) fd.set('defaultPlatform', defaults.value.platform);
  result.value = await $fetch(`/api/apps/${appId.value}/imports`, {
    method: 'POST',
    body: fd,
    headers: csrf.headers(),
  });
  step.value = 'results';
}
</script>

<template>
  <div>
    <div class="page-head">
      <div class="page-head-text">
        <h1>Devices</h1>
        <p class="page-head-subtitle">Import device tokens from a CSV or JSON file in three steps.</p>
      </div>
    </div>

    <!-- Step indicators -->
    <div class="tab-strip" style="margin-bottom:28px;">
      <span
        class="tab-item"
        :class="{ active: step === 'upload' }"
      >1. Upload file</span>
      <span
        class="tab-item"
        :class="{ active: step === 'map' }"
      >2. Map columns</span>
      <span
        class="tab-item"
        :class="{ active: step === 'results' }"
      >3. Results</span>
    </div>

    <!-- Step 1: Upload -->
    <div v-if="step === 'upload'" data-testid="step-upload">
      <div class="panel">
        <h2 style="margin-bottom:6px;">Import devices</h2>
        <p class="text-muted text-sm" style="margin-bottom:18px;">Select a CSV or JSON file containing device tokens to import.</p>
        <div class="field">
          <label>File (.csv or .json)</label>
          <input
            type="file"
            accept=".csv,.json"
            data-testid="file-input"
            @change="onFileChosen"
          />
        </div>
      </div>
    </div>

    <!-- Step 2: Map columns -->
    <div v-else-if="step === 'map'" data-testid="step-map">
      <div class="panel">
        <h2 style="margin-bottom:6px;">Map columns</h2>
        <p class="text-muted text-sm" style="margin-bottom:18px;">
          Match your file's columns to the required fields. Required: token. Provider and platform can come from a column or a default value.
        </p>
        <div class="stack">
          <div class="form-row">
            <div class="field">
              <label>Token column</label>
              <select v-model="mapping.token" data-testid="map-token">
                <option value="">(select column)</option>
                <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
              </select>
            </div>
            <div class="field">
              <label>Provider column</label>
              <select v-model="mapping.provider">
                <option value="">(use default)</option>
                <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
              </select>
            </div>
            <div class="field">
              <label>Platform column</label>
              <select v-model="mapping.platform">
                <option value="">(use default)</option>
                <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Default provider</label>
              <input v-model="defaults.provider" placeholder="fcm | huawei" />
            </div>
            <div class="field">
              <label>Default platform</label>
              <input v-model="defaults.platform" placeholder="android | ios | web | huawei" />
            </div>
          </div>
          <div>
            <button class="btn btn-primary" data-testid="run-import" @click="runImport">Import</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Step 3: Results -->
    <div v-else data-testid="step-results">
      <div class="panel">
        <h2 style="margin-bottom:18px;">Import complete</h2>
        <div class="table-wrap" style="margin-bottom:20px;">
          <table class="table">
            <thead>
              <tr>
                <th>Outcome</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Inserted</td>
                <td class="font-medium" data-testid="result-inserted">{{ result?.inserted }}</td>
              </tr>
              <tr>
                <td>Updated</td>
                <td class="font-medium" data-testid="result-updated">{{ result?.updated }}</td>
              </tr>
              <tr>
                <td>Failed (rejected)</td>
                <td class="font-medium text-danger" data-testid="result-failed">{{ result?.failed }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button class="btn btn-ghost" @click="step = 'upload'">Import more</button>
      </div>
    </div>
  </div>
</template>
