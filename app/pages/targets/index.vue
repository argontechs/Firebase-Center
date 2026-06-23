<script setup lang="ts">
import { ref, computed } from 'vue';
import { useDevices } from '~/composables/useDevices';

// Read optional ?appId= from route for initial filter
const route = useRoute();
const appFilter = ref<string>(String(route.query.appId ?? ''));
const platformFilter = ref<string>('');
const providerFilter = ref<string>('');
const tagFilter = ref<string>('');
const searchQ = ref<string>('');

// Build query params reactively
function buildParams() {
  const p: Record<string, string> = {};
  if (appFilter.value) p.appId = appFilter.value;
  if (platformFilter.value) p.platform = platformFilter.value;
  if (providerFilter.value) p.provider = providerFilter.value;
  if (tagFilter.value) p.tag = tagFilter.value;
  if (searchQ.value) p.q = searchQ.value;
  return p;
}

function buildQuery() {
  const q = new URLSearchParams(buildParams());
  const qs = q.toString();
  return `/api/devices${qs ? `?${qs}` : ''}`;
}

const { data: deviceData, refresh } = await useFetch(buildQuery, { default: () => ({ devices: [] }) });

const devices = computed(() => (deviceData.value as { devices: unknown[] })?.devices ?? []);

// Add-form state
const showForm = ref(false);
const newToken = ref('');
const newPlatform = ref<'android' | 'ios' | 'huawei' | 'web'>('android');
const newProvider = ref<'fcm' | 'huawei'>('fcm');
const newTagsInput = ref('');
const newExternalUserId = ref('');
const formError = ref('');
const saving = ref(false);

// Inline edit state (tag editing per row)
const editingId = ref<string | null>(null);
const editTagsInput = ref('');
const editSaving = ref(false);

const devicesComposable = useDevices();

async function applyFilter() {
  await refresh();
}

function formatTags(input: string): string[] {
  return input
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

async function saveTarget() {
  if (!newToken.value.trim()) {
    formError.value = 'Token is required';
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    await devicesComposable.manualAdd(appFilter.value || '', {
      token: newToken.value.trim(),
      provider: newProvider.value,
      platform: newPlatform.value,
      externalUserId: newExternalUserId.value.trim() || undefined,
      tags: formatTags(newTagsInput.value),
    });
    // Reset form
    newToken.value = '';
    newPlatform.value = 'android';
    newProvider.value = 'fcm';
    newTagsInput.value = '';
    newExternalUserId.value = '';
    showForm.value = false;
    await refresh();
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string };
    if (err.statusCode === 409) {
      formError.value = 'A device with that token already exists for this app.';
    } else {
      formError.value = err.statusMessage ?? 'Failed to add target';
    }
  } finally {
    saving.value = false;
  }
}

async function deleteDevice(id: string) {
  await devicesComposable.remove(id);
  await refresh();
}

function startEdit(d: { id: string; tags: string[] }) {
  editingId.value = d.id;
  editTagsInput.value = d.tags.join(', ');
}

function cancelEdit() {
  editingId.value = null;
  editTagsInput.value = '';
}

async function saveTags(id: string) {
  editSaving.value = true;
  try {
    await devicesComposable.setTags(id, formatTags(editTagsInput.value));
    editingId.value = null;
    editTagsInput.value = '';
    await refresh();
  } finally {
    editSaving.value = false;
  }
}

function formatDate(d: string | null) {
  if (!d) return '--';
  return new Date(d).toLocaleDateString();
}
</script>

<template>
  <div>
    <!-- Page header -->
    <div class="page-head">
      <div class="page-head-text">
        <h1 data-test="targets-title" class="page-head-title">Targets</h1>
        <p class="page-head-subtitle">Manage registered devices and their tags.</p>
      </div>
      <div class="page-head-actions">
        <NuxtLink
          to="/imports/devices"
          class="btn btn-ghost"
          data-test="bulk-import-link"
        >Bulk import</NuxtLink>
        <button
          type="button"
          class="btn btn-primary"
          data-test="add-target-btn"
          @click="showForm = !showForm"
        >+ Add target</button>
      </div>
    </div>

    <!-- Manual add form panel -->
    <div v-if="showForm" class="panel section-gap">
      <form data-test="add-target-form" class="stack" @submit.prevent="saveTarget">
        <p v-if="formError" class="form-error">{{ formError }}</p>
        <div class="field">
          <label class="field-label" for="target-app-id">App ID</label>
          <input
            id="target-app-id"
            v-model="appFilter"
            type="text"
            placeholder="App UUID"
            data-test="app-filter"
          />
        </div>
        <div class="field">
          <label class="field-label" for="target-token">Device token</label>
          <input
            id="target-token"
            v-model="newToken"
            type="text"
            placeholder="FCM or HMS push token"
            class="mono"
            data-test="token-input"
          />
        </div>
        <div class="field">
          <label class="field-label" for="target-platform">Platform</label>
          <select id="target-platform" v-model="newPlatform" data-test="platform-select">
            <option value="android">Android</option>
            <option value="ios">iOS</option>
            <option value="huawei">Huawei</option>
            <option value="web">Web</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label" for="target-provider">Provider</label>
          <select id="target-provider" v-model="newProvider" data-test="provider-select">
            <option value="fcm">FCM</option>
            <option value="huawei">Huawei</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label" for="target-external-id">External user ID (optional)</label>
          <input
            id="target-external-id"
            v-model="newExternalUserId"
            type="text"
            placeholder="Your internal user identifier"
          />
        </div>
        <div class="field">
          <label class="field-label" for="target-tags">Tags (comma or semicolon separated)</label>
          <input
            id="target-tags"
            v-model="newTagsInput"
            type="text"
            placeholder="vip, kl"
            data-test="tags-input"
          />
        </div>
        <div class="cluster">
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="saving"
            data-test="save-target-btn"
          >{{ saving ? 'Saving...' : 'Save target' }}</button>
          <button type="button" class="btn btn-ghost" @click="showForm = false">Cancel</button>
        </div>
      </form>
    </div>

    <!-- Filter bar (when form is not open, app-filter is shown here) -->
    <div v-if="!showForm" class="filter-bar section-gap">
      <input
        v-model="appFilter"
        type="text"
        placeholder="Filter by App ID"
        class="filter-input"
        data-test="app-filter"
        @change="applyFilter"
      />
      <select v-model="platformFilter" @change="applyFilter">
        <option value="">All platforms</option>
        <option value="android">Android</option>
        <option value="ios">iOS</option>
        <option value="huawei">Huawei</option>
        <option value="web">Web</option>
      </select>
      <select v-model="providerFilter" @change="applyFilter">
        <option value="">All providers</option>
        <option value="fcm">FCM</option>
        <option value="huawei">Huawei</option>
      </select>
      <input
        v-model="tagFilter"
        type="text"
        placeholder="Filter by tag"
        @change="applyFilter"
      />
      <input
        v-model="searchQ"
        type="text"
        placeholder="Search token / user ID"
        @change="applyFilter"
      />
    </div>

    <!-- Devices table -->
    <div class="section-gap">
      <div v-if="!devices || devices.length === 0" class="empty">
        <p class="empty-message">No devices found.</p>
        <p class="empty-hint">Add a target manually or bulk import a CSV file.</p>
        <button type="button" class="btn btn-primary" @click="showForm = true">+ Add target</button>
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Platform</th>
              <th>Provider</th>
              <th>Tags</th>
              <th>Status</th>
              <th>External user</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="d in (devices as any[])"
              :key="d.id"
              data-test="device-row"
            >
              <td class="mono text-muted">{{ d.token }}</td>
              <td>{{ d.platform }}</td>
              <td>{{ d.provider }}</td>
              <td>
                <!-- Inline tag edit mode -->
                <template v-if="editingId === d.id">
                  <div class="cluster" style="gap: 6px;">
                    <input
                      v-model="editTagsInput"
                      type="text"
                      placeholder="vip, kl"
                      data-test="edit-tags-input"
                      style="flex: 1; min-width: 120px;"
                    />
                    <button
                      type="button"
                      class="btn btn-primary"
                      :disabled="editSaving"
                      data-test="save-tags-btn"
                      @click="saveTags(d.id)"
                    >{{ editSaving ? 'Saving...' : 'Save' }}</button>
                    <button
                      type="button"
                      class="btn btn-ghost"
                      data-test="cancel-edit-btn"
                      @click="cancelEdit"
                    >Cancel</button>
                  </div>
                </template>
                <template v-else>
                  <span
                    v-for="tag in d.tags"
                    :key="tag"
                    class="badge badge-muted"
                    style="margin-right: 4px;"
                  >{{ tag }}</span>
                  <span v-if="!d.tags || d.tags.length === 0" class="text-faint">--</span>
                </template>
              </td>
              <td>
                <span
                  class="badge"
                  :class="d.status === 'active' ? 'badge-ok' : 'badge-danger'"
                >{{ d.status }}</span>
              </td>
              <td class="mono text-muted">{{ d.externalUserId ?? '--' }}</td>
              <td class="text-muted">{{ formatDate(d.createdAt) }}</td>
              <td>
                <div class="cluster" style="justify-content: flex-end;">
                  <button
                    type="button"
                    class="btn btn-ghost"
                    data-test="edit-device-btn"
                    @click="startEdit(d)"
                  >Edit</button>
                  <button
                    type="button"
                    class="btn btn-danger"
                    @click="deleteDevice(d.id)"
                  >Delete</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
