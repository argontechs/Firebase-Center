<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';

defineOptions({ name: 'SendKeysPage' });

const route = useRoute();
const companyId = String(route.params.id);

// useCsrf is auto-imported by Nuxt; fetchToken() is called before each mutating fetch
// to match the project CSRF convention.
const csrf = useCsrf();

interface KeyMeta {
  id: string;
  keyPrefix: string;
  version: number;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const { data: keys, refresh } = await useFetch<KeyMeta[]>(
  `/api/companies/${companyId}/send-keys`,
  { default: () => [] },
);

const showOnceKey = ref<string | null>(null);

async function issueKey() {
  await csrf.fetchToken();
  const res: { id: string; fullKey: string; keyPrefix: string; version: number } = await $fetch(
    `/api/companies/${companyId}/send-keys`,
    { method: 'POST', headers: csrf.headers(), body: {} },
  );
  showOnceKey.value = res.fullKey;
  await refresh();
}

async function revokeKey(id: string) {
  await csrf.fetchToken();
  await $fetch(`/api/companies/${companyId}/send-keys/${id}/revoke`, {
    method: 'POST',
    headers: csrf.headers(),
  });
  await refresh();
}
</script>

<template>
  <section>
    <h2>Send keys</h2>
    <button data-testid="issue-key" @click="issueKey">Issue key</button>

    <div v-if="showOnceKey" data-testid="show-once-key" class="show-once">
      <strong>Copy this key now — you won't see this again:</strong>
      <code>{{ showOnceKey }}</code>
      <button data-testid="dismiss-show-once" @click="showOnceKey = null">I've copied it</button>
    </div>

    <table>
      <thead>
        <tr>
          <th>Prefix</th>
          <th>Label</th>
          <th>Version</th>
          <th>Created</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="k in keys" :key="k.id" :data-testid="`key-row-${k.id}`">
          <td>{{ k.keyPrefix }}…</td>
          <td>{{ k.label ?? '—' }}</td>
          <td>{{ k.version }}</td>
          <td>{{ k.createdAt }}</td>
          <td>{{ k.revokedAt ? 'revoked' : 'active' }}</td>
          <td>
            <button
              v-if="!k.revokedAt"
              :data-testid="`revoke-${k.id}`"
              @click="revokeKey(k.id)"
            >Revoke</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
