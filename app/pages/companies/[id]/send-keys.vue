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
  <div>
    <div class="page-head">
      <div class="page-head-text">
        <h1 class="page-head-title">Send keys</h1>
        <p class="page-head-subtitle">
          Issue send keys for this company. Keys are shown in full once at creation; afterwards only the prefix is listed.
        </p>
      </div>
      <div class="page-head-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-testid="issue-key"
          @click="issueKey"
        >
          Issue key
        </button>
      </div>
    </div>

    <div v-if="showOnceKey" class="callout row-gap" data-testid="show-once-key" style="max-width: 640px; margin-bottom: 24px;">
      <p class="callout-title">Copy this key now. You won't see this again.</p>
      <p class="callout-body">Store it securely. Once you dismiss this, only the key prefix will be shown.</p>
      <div class="callout-key-row">
        <code>{{ showOnceKey }}</code>
      </div>
      <div>
        <button
          type="button"
          class="btn btn-ghost"
          data-testid="dismiss-show-once"
          @click="showOnceKey = null"
        >
          I've copied it
        </button>
      </div>
    </div>

    <div v-if="keys && keys.length > 0" class="table-wrap">
      <table class="table">
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
            <td class="mono">{{ k.keyPrefix }}…</td>
            <td><span v-if="k.label">{{ k.label }}</span><span v-else class="text-faint">-</span></td>
            <td class="mono">{{ k.version }}</td>
            <td class="mono text-muted">{{ k.createdAt }}</td>
            <td>
              <span v-if="k.revokedAt" class="badge badge-danger">revoked</span>
              <span v-else class="badge badge-ok">active</span>
            </td>
            <td style="text-align: right;">
              <button
                v-if="!k.revokedAt"
                type="button"
                class="btn btn-danger"
                style="padding: 5px 10px; font-size: var(--t-xs);"
                :data-testid="`revoke-${k.id}`"
                @click="revokeKey(k.id)"
              >
                Revoke
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="empty">
      <p class="empty-message">No send keys yet.</p>
      <p class="empty-hint">Issue a key above to allow authenticated sends for this company.</p>
    </div>
  </div>
</template>
