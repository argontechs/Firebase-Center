<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useCredentials } from '~~/app/composables/useCredentials';

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

// Rotate panel state — write-only, never pre-filled from server
const rotatingId = ref<string | null>(null);
const rotateSecret = ref('');   // write-only: cleared after rotate

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

function openRotate(cid: string) {
  rotatingId.value = cid;
  rotateSecret.value = '';       // always start empty — write-only guarantee
}

function cancelRotate() {
  rotatingId.value = null;
  rotateSecret.value = '';
}

async function onRotate() {
  if (!rotatingId.value || !rotateSecret.value) return;
  const meta = await rotate(rotatingId.value, { secret: rotateSecret.value });
  lastFingerprint.value = meta.fingerprint;
  rotateSecret.value = '';       // clear after submit — write-only
  rotatingId.value = null;
  await reload();
}

onMounted(reload);
</script>

<template>
  <div>
    <div class="page-head">
      <div class="page-head-text">
        <h2>Credentials</h2>
        <p class="page-head-subtitle">Write-only push credentials per provider and platform. Secrets are never shown after save.</p>
      </div>
    </div>

    <!-- Credentials table -->
    <div class="table-wrap">
      <table class="table">
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
          <tr v-if="credentials.length === 0">
            <td colspan="5">
              <div class="empty">
                <p class="empty-message">No credentials configured yet.</p>
                <p class="empty-hint">Add a credential below to enable push delivery for this app.</p>
              </div>
            </td>
          </tr>
          <tr v-for="c in credentials" :key="c.id" :data-test="`cred-row-${c.id}`">
            <td class="font-medium">{{ c.provider }}</td>
            <td class="text-muted">{{ c.platform }}</td>
            <td class="mono text-muted">{{ c.projectId || c.huaweiAppId || '—' }}</td>
            <td>
              <span v-if="c.ready" class="badge badge-ok" data-test="badge-ready">Ready</span>
              <span v-else class="badge badge-warn" data-test="badge-not-ready">Not ready</span>
            </td>
            <td>
              <button
                type="button"
                class="btn btn-ghost"
                :data-test="`rotate-${c.id}`"
                @click="openRotate(c.id)"
              >Rotate</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Rotate panel: write-only textarea, never pre-filled from server -->
    <div v-if="rotatingId" class="panel section-gap" data-test="rotate-panel">
      <h2 class="text-sm font-medium" style="margin-bottom:14px;">Rotate secret (write-only)</h2>
      <div class="stack">
        <div class="field field-mono">
          <label>New secret</label>
          <textarea
            v-model="rotateSecret"
            class="mono"
            data-test="rotate-secret-input"
            placeholder="Paste new secret — never shown again"
          ></textarea>
        </div>
        <div class="cluster">
          <button type="button" class="btn btn-primary" data-test="rotate-confirm-btn" @click="onRotate">Confirm Rotate</button>
          <button type="button" class="btn btn-ghost" data-test="rotate-cancel-btn" @click="cancelRotate">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Add credential panel (write-only) -->
    <div class="panel section-gap">
      <h2 class="text-sm font-medium" style="margin-bottom:14px;">Add credential (write-only)</h2>
      <p
        v-if="lastFingerprint"
        class="badge badge-ok"
        style="margin-bottom:14px; display:inline-flex;"
        data-test="last-fingerprint"
      >Saved. Fingerprint: {{ lastFingerprint }}</p>
      <form class="stack" @submit.prevent="onSave">
        <div class="form-row">
          <div class="field">
            <label>Provider</label>
            <select v-model="provider" data-test="provider-select">
              <option value="fcm">fcm</option>
              <option value="huawei">huawei</option>
            </select>
          </div>
          <div class="field">
            <label>Platform</label>
            <select v-model="platform" data-test="platform-select">
              <option value="ios">ios</option>
              <option value="android">android</option>
              <option value="huawei">huawei</option>
              <option value="web">web</option>
              <option value="any">any</option>
            </select>
          </div>
          <div class="field">
            <label>Label (optional)</label>
            <input v-model="label" data-test="label-input" placeholder="e.g. Production FCM" />
          </div>
        </div>
        <div class="field field-mono">
          <label>Secret</label>
          <textarea
            v-model="secret"
            class="mono"
            data-test="secret-input"
            placeholder="Paste SA JSON / App Secret — never shown again"
          ></textarea>
        </div>
        <div>
          <button type="button" class="btn btn-primary" data-test="save-btn" @click="onSave">Save</button>
        </div>
      </form>
    </div>
  </div>
</template>
