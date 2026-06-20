<script setup lang="ts">
import { ref } from 'vue';
import { useCredentialImport } from '~/composables/useCredentialImport';
import type { CredImportResult } from '~~/server/utils/import/credentials';

const { submit } = useCredentialImport();
const manifest = ref<File | null>(null);
const jsonFiles = ref<File[]>([]);
const result = ref<CredImportResult | null>(null);
const busy = ref(false);

function onManifest(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null;
  manifest.value = f;
}
function onJsonFiles(e: Event) {
  jsonFiles.value = Array.from((e.target as HTMLInputElement).files ?? []);
}
async function onImport() {
  if (!manifest.value) return;
  busy.value = true;
  try {
    result.value = await submit(manifest.value, jsonFiles.value);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div class="page-head-text">
        <h1 class="page-head-title">Import credentials</h1>
        <p class="page-head-subtitle">
          Upload a CSV manifest plus the FCM service-account
          <code>.json</code> files it references.
        </p>
      </div>
    </div>

    <div class="panel" style="max-width: 560px;">
      <div class="stack">
        <div class="field">
          <label for="manifest-file-input">Manifest CSV</label>
          <input
            id="manifest-file-input"
            type="file"
            accept=".csv,text/csv"
            data-test="manifest-input"
            @change="onManifest"
          />
        </div>

        <div class="field">
          <label for="json-files-input">Service-account JSON files</label>
          <input
            id="json-files-input"
            type="file"
            accept=".json,application/json"
            multiple
            data-test="json-input"
            @change="onJsonFiles"
          />
        </div>

        <div>
          <button
            type="button"
            class="btn btn-primary"
            data-test="import-btn"
            :disabled="!manifest || busy"
            @click="onImport"
          >
            {{ busy ? 'Importing...' : 'Import' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="result" class="section-gap" data-test="import-summary">
      <div class="panel" style="max-width: 560px;">
        <p class="text-xs text-muted font-medium" style="text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 14px;">
          Import summary
        </p>
        <div class="cluster" style="margin-bottom: 16px;">
          <span class="badge badge-ok">Created: {{ result.created }}</span>
          <span class="badge badge-muted">Updated: {{ result.updated }}</span>
          <span v-if="result.failed > 0" class="badge badge-danger">Failed: {{ result.failed }}</span>
          <span v-else class="badge badge-ok">Failed: 0</span>
        </div>

        <div v-if="result.errors.length" data-test="import-errors">
          <p class="text-xs text-muted font-medium" style="text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px;">
            Errors
          </p>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in result.errors" :key="e.rowNumber">
                  <td class="mono" style="width: 72px;">{{ e.rowNumber }}</td>
                  <td>{{ e.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
