<script setup lang="ts">
import { ref } from 'vue';
import { useCredentialImport } from '~/app/composables/useCredentialImport';
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
  <section>
    <h1>Import credentials</h1>
    <p>Upload a CSV manifest plus the FCM service-account <code>.json</code> files it references.</p>

    <label>Manifest CSV
      <input type="file" accept=".csv,text/csv" data-test="manifest-input" @change="onManifest" />
    </label>
    <label>Service-account JSON files
      <input type="file" accept=".json,application/json" multiple data-test="json-input" @change="onJsonFiles" />
    </label>
    <button type="button" data-test="import-btn" :disabled="!manifest || busy" @click="onImport">Import</button>

    <div v-if="result" data-test="import-summary">
      <p>Created: {{ result.created }} · Updated: {{ result.updated }} · Failed: {{ result.failed }}</p>
      <ul v-if="result.errors.length" data-test="import-errors">
        <li v-for="e in result.errors" :key="e.rowNumber">Row {{ e.rowNumber }}: {{ e.reason }}</li>
      </ul>
    </div>
  </section>
</template>
