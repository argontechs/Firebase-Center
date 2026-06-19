<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useCredentials } from '~/app/composables/useCredentials';

defineOptions({ name: 'CredentialsPage' });

const route = useRoute();
const appId = route.params.id as string;
const { fetchList, save, rotate } = useCredentials(appId);

const credentials = ref<any[]>([]);
const provider = ref<'fcm' | 'huawei'>('fcm');
const platform = ref<'ios' | 'android' | 'huawei' | 'web' | 'any'>('android');
const label = ref('');
const secret = ref('');          // write-only: never hydrated from server, cleared after save
const lastFingerprint = ref<string | null>(null);

async function reload() {
  credentials.value = await fetchList();
}

async function onSave() {
  const meta = await save({
    provider: provider.value,
    platform: platform.value,
    label: label.value || undefined,
    secret: secret.value,
  });
  lastFingerprint.value = meta.fingerprint;
  secret.value = '';             // clear the write-only field
  label.value = '';
  await reload();
}

async function onRotate(cid: string) {
  const next = window.prompt('Paste the NEW secret (write-only):');
  if (!next) return;
  const meta = await rotate(cid, { secret: next });
  lastFingerprint.value = meta.fingerprint;
  await reload();
}

onMounted(reload);
</script>

<template>
  <section>
    <h1>Credentials</h1>

    <table>
      <thead>
        <tr>
          <th>Provider</th>
          <th>Platform</th>
          <th>Project / App ID</th>
          <th>Readiness</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in credentials" :key="c.id" :data-test="`cred-row-${c.id}`">
          <td>{{ c.provider }}</td>
          <td>{{ c.platform }}</td>
          <td>{{ c.projectId || c.huaweiAppId || '—' }}</td>
          <td>
            <span v-if="c.ready" data-test="badge-ready">Ready</span>
            <span v-else data-test="badge-not-ready">Not ready</span>
          </td>
          <td>
            <button type="button" :data-test="`rotate-${c.id}`" @click="onRotate(c.id)">Rotate</button>
          </td>
        </tr>
      </tbody>
    </table>

    <h2>Add credential (write-only)</h2>
    <p v-if="lastFingerprint" data-test="last-fingerprint">Saved. Fingerprint: {{ lastFingerprint }}</p>
    <form @submit.prevent="onSave">
      <select v-model="provider" data-test="provider-select">
        <option value="fcm">fcm</option>
        <option value="huawei">huawei</option>
      </select>
      <select v-model="platform" data-test="platform-select">
        <option value="ios">ios</option>
        <option value="android">android</option>
        <option value="huawei">huawei</option>
        <option value="web">web</option>
        <option value="any">any</option>
      </select>
      <input v-model="label" data-test="label-input" placeholder="Label (optional)" />
      <textarea
        v-model="secret"
        data-test="secret-input"
        placeholder="Paste SA JSON / App Secret — never shown again"
      ></textarea>
      <button type="button" data-test="save-btn" @click="onSave">Save</button>
    </form>
  </section>
</template>
