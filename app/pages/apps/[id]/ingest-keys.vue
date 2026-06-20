<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

defineOptions({ name: 'IngestKeysPage' });

const route = useRoute();
const appId = computed(() => String(route.params.id));
// useCsrf is auto-imported by Nuxt; fetchToken() is called before each mutating fetch
// to match the project CSRF convention (same pattern as login.vue and useCredentialImport.ts).
const csrf = useCsrf();

interface KeyMeta {
  id: string;
  keyPrefix: string;
  version: number;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const keys = ref<KeyMeta[]>([]);
const showOnceKey = ref<string | null>(null);

async function refresh() {
  keys.value = await $fetch(`/api/apps/${appId.value}/ingest-keys`);
}

async function issueKey() {
  await csrf.fetchToken();
  const res: { key: string; id: string; prefix: string; version: number } = await $fetch(
    `/api/apps/${appId.value}/ingest-keys`,
    { method: 'POST', headers: csrf.headers(), body: {} },
  );
  showOnceKey.value = res.key;
  await refresh();
}

async function rotateKey(id: string) {
  await csrf.fetchToken();
  const res: { key: string; id: string; prefix: string; version: number } = await $fetch(
    `/api/apps/${appId.value}/ingest-keys/${id}/rotate`,
    { method: 'POST', headers: csrf.headers() },
  );
  showOnceKey.value = res.key;
  await refresh();
}

async function revokeKey(id: string) {
  await csrf.fetchToken();
  await $fetch(`/api/apps/${appId.value}/ingest-keys/${id}/revoke`, {
    method: 'POST',
    headers: csrf.headers(),
  });
  await refresh();
}

onMounted(refresh);
</script>

<template>
  <div>
    <div class="page-head">
      <div class="page-head-text">
        <h2>Ingest keys</h2>
        <p class="page-head-subtitle">Keys are shown in full only once, immediately after issue or rotate. Only the prefix is stored and displayed afterwards.</p>
      </div>
      <div class="page-head-actions">
        <button class="btn btn-primary" data-testid="issue-key" @click="issueKey">Issue new key</button>
      </div>
    </div>

    <!-- Show-once callout: full key shown exactly once, then dismissed -->
    <div v-if="showOnceKey" class="callout section-gap" data-testid="show-once-key">
      <p class="callout-title">Copy this key now — it will not be shown again</p>
      <p class="callout-body">Store it securely. After you dismiss this notice only the key prefix will be visible.</p>
      <div class="callout-key-row">
        <code>{{ showOnceKey }}</code>
        <button
          class="btn btn-ghost"
          style="flex-shrink:0;"
          @click="() => { navigator.clipboard.writeText(showOnceKey!); }"
        >Copy</button>
      </div>
      <div>
        <button class="btn btn-ghost" @click="showOnceKey = null">I've copied it</button>
      </div>
    </div>

    <!-- Keys table -->
    <div class="table-wrap section-gap">
      <table class="table">
        <thead>
          <tr>
            <th>Prefix</th>
            <th>Version</th>
            <th>Label</th>
            <th>Created</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="keys.length === 0">
            <td colspan="6">
              <div class="empty">
                <p class="empty-message">No ingest keys yet.</p>
                <p class="empty-hint">Issue a key to allow devices to send data to this app.</p>
              </div>
            </td>
          </tr>
          <tr v-for="k in keys" :key="k.id" :data-testid="`key-row-${k.id}`">
            <td class="mono">{{ k.keyPrefix }}&hellip;</td>
            <td class="text-muted">{{ k.version }}</td>
            <td class="text-muted">{{ k.label || '—' }}</td>
            <td class="text-muted text-xs">{{ k.createdAt }}</td>
            <td>
              <span v-if="k.revokedAt" class="badge badge-danger">revoked</span>
              <span v-else class="badge badge-ok">active</span>
            </td>
            <td>
              <div class="cluster" style="gap:6px;">
                <button
                  v-if="!k.revokedAt"
                  class="btn btn-ghost"
                  style="padding:5px 10px; font-size:var(--t-xs);"
                  @click="rotateKey(k.id)"
                >Rotate</button>
                <button
                  v-if="!k.revokedAt"
                  class="btn btn-danger"
                  style="padding:5px 10px; font-size:var(--t-xs);"
                  @click="revokeKey(k.id)"
                >Revoke</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
