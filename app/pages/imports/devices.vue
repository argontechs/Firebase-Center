<script setup lang="ts">
import { ref } from 'vue';
import { useCsrf } from '~/composables/useCsrf';

interface ImportResult {
  importId: string;
  total: number;
  inserted: number;
  updated: number;
  failed: number;
}

const csrf = useCsrf();

// App selection
const appId = ref('');

// File
const csvFile = ref<File | null>(null);

// Column mapping (optional overrides; defaults match common header names)
const colToken = ref('token');
const colProvider = ref('provider');
const colPlatform = ref('platform');
const colExternalUserId = ref('externalUserId');
const colTags = ref('tags');

// Defaults (used when provider/platform columns are absent)
const defaultProvider = ref<'fcm' | 'huawei' | ''>('');
const defaultPlatform = ref<'android' | 'ios' | 'huawei' | 'web' | ''>('');

const busy = ref(false);
const error = ref('');
const result = ref<ImportResult | null>(null);

function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null;
  csvFile.value = f;
  result.value = null;
  error.value = '';
}

async function onImport() {
  if (!appId.value.trim()) {
    error.value = 'Please enter an App ID.';
    return;
  }
  if (!csvFile.value) {
    error.value = 'Please select a CSV file.';
    return;
  }

  busy.value = true;
  error.value = '';
  result.value = null;

  try {
    await csrf.fetchToken();

    const mapping: Record<string, string> = { token: colToken.value || 'token' };
    if (colProvider.value) mapping.provider = colProvider.value;
    if (colPlatform.value) mapping.platform = colPlatform.value;
    if (colExternalUserId.value) mapping.externalUserId = colExternalUserId.value;
    if (colTags.value) mapping.tags = colTags.value;

    const fd = new FormData();
    fd.set('file', csvFile.value, csvFile.value.name);
    fd.set('format', 'csv');
    fd.set('mapping', JSON.stringify(mapping));
    if (defaultProvider.value) fd.set('defaultProvider', defaultProvider.value);
    if (defaultPlatform.value) fd.set('defaultPlatform', defaultPlatform.value);

    result.value = await $fetch<ImportResult>(`/api/apps/${appId.value.trim()}/imports`, {
      method: 'POST',
      headers: csrf.headers(),
      body: fd,
    });
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; message?: string };
    error.value = err.statusMessage ?? err.message ?? 'Import failed.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div class="page-head-text">
        <h1 class="page-head-title" data-test="import-devices-title">Import devices</h1>
        <p class="page-head-subtitle">
          Upload a CSV file of device tokens. Map the column headers below then click Import.
        </p>
      </div>
      <div class="page-head-actions">
        <NuxtLink to="/targets" class="btn btn-ghost">Back to Targets</NuxtLink>
      </div>
    </div>

    <div class="panel" style="max-width: 580px;">
      <div class="stack">
        <div v-if="error" class="callout" style="margin-bottom: 8px;" data-test="import-error">
          {{ error }}
        </div>

        <div class="field">
          <label class="field-label" for="import-app-id">App ID</label>
          <input
            id="import-app-id"
            v-model="appId"
            type="text"
            placeholder="UUID of the app to import devices into"
            class="mono"
            data-test="import-app-id"
          />
        </div>

        <div class="field">
          <label class="field-label" for="import-csv-file">CSV file</label>
          <input
            id="import-csv-file"
            type="file"
            accept=".csv,text/csv"
            data-test="import-csv-file"
            @change="onFile"
          />
        </div>

        <details>
          <summary style="cursor: pointer; font-size: var(--t-sm); color: var(--text-muted); margin-bottom: 8px;">
            Column mapping (optional)
          </summary>
          <div class="stack" style="margin-top: 10px;">
            <div class="field">
              <label class="field-label" for="col-token">Token column</label>
              <input id="col-token" v-model="colToken" type="text" placeholder="token" data-test="col-token" />
            </div>
            <div class="field">
              <label class="field-label" for="col-provider">Provider column</label>
              <input id="col-provider" v-model="colProvider" type="text" placeholder="provider" data-test="col-provider" />
            </div>
            <div class="field">
              <label class="field-label" for="col-platform">Platform column</label>
              <input id="col-platform" v-model="colPlatform" type="text" placeholder="platform" data-test="col-platform" />
            </div>
            <div class="field">
              <label class="field-label" for="col-external-user-id">External user ID column</label>
              <input id="col-external-user-id" v-model="colExternalUserId" type="text" placeholder="externalUserId" data-test="col-external-user-id" />
            </div>
            <div class="field">
              <label class="field-label" for="col-tags">Tags column (values split on comma or semicolon)</label>
              <input id="col-tags" v-model="colTags" type="text" placeholder="tags" data-test="col-tags" />
            </div>
          </div>
        </details>

        <details>
          <summary style="cursor: pointer; font-size: var(--t-sm); color: var(--text-muted); margin-bottom: 8px;">
            Default values (applied when column is absent)
          </summary>
          <div class="stack" style="margin-top: 10px;">
            <div class="field">
              <label class="field-label" for="default-provider">Default provider</label>
              <select id="default-provider" v-model="defaultProvider" data-test="default-provider">
                <option value="">-- none --</option>
                <option value="fcm">FCM</option>
                <option value="huawei">Huawei</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="default-platform">Default platform</label>
              <select id="default-platform" v-model="defaultPlatform" data-test="default-platform">
                <option value="">-- none --</option>
                <option value="android">Android</option>
                <option value="ios">iOS</option>
                <option value="huawei">Huawei</option>
                <option value="web">Web</option>
              </select>
            </div>
          </div>
        </details>

        <div>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="busy || !csvFile || !appId.trim()"
            data-test="import-devices-btn"
            @click="onImport"
          >
            {{ busy ? 'Importing...' : 'Import' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="result" class="section-gap" data-test="import-devices-summary">
      <div class="panel" style="max-width: 580px;">
        <p class="text-xs text-muted" style="text-transform: uppercase; letter-spacing: 0.06em; font-weight: 550; margin-bottom: 14px;">
          Import summary
        </p>
        <div class="cluster">
          <span class="badge badge-muted">Total: {{ result.total }}</span>
          <span class="badge badge-ok">Inserted: {{ result.inserted }}</span>
          <span class="badge badge-muted">Updated: {{ result.updated }}</span>
          <span :class="result.failed > 0 ? 'badge badge-danger' : 'badge badge-ok'">
            Failed: {{ result.failed }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
