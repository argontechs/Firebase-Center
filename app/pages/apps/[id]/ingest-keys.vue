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
  <section>
    <h2>Ingest keys</h2>
    <button data-testid="issue-key" @click="issueKey">Issue new key</button>

    <div v-if="showOnceKey" data-testid="show-once-key" class="show-once">
      <strong>Copy this key now — it will not be shown again:</strong>
      <code>{{ showOnceKey }}</code>
      <button @click="showOnceKey = null">I've copied it</button>
    </div>

    <table>
      <thead>
        <tr>
          <th>Prefix</th>
          <th>Version</th>
          <th>Created</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="k in keys" :key="k.id" :data-testid="`key-row-${k.id}`">
          <td>{{ k.keyPrefix }}…</td>
          <td>{{ k.version }}</td>
          <td>{{ k.createdAt }}</td>
          <td>{{ k.revokedAt ? 'revoked' : 'active' }}</td>
          <td>
            <button v-if="!k.revokedAt" @click="rotateKey(k.id)">Rotate</button>
            <button v-if="!k.revokedAt" @click="revokeKey(k.id)">Revoke</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
