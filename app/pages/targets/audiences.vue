<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAudiences } from '~/composables/useAudiences';

const route = useRoute();
const appId = ref<string>(String(route.query.appId ?? ''));

// Fetch audiences from the API
function buildUrl() {
  return `/api/apps/${appId.value}/audiences`;
}

const { data: audiencesRaw, refresh } = await useFetch(buildUrl, {
  default: () => [],
});

const audiences = computed(() => (audiencesRaw.value as unknown[]) ?? []);

// Create-form state
const showForm = ref(false);
const newName = ref('');
const newPlatform = ref<'android' | 'ios' | 'huawei' | 'web' | ''>('');
const newProvider = ref<'fcm' | 'huawei' | ''>('');
const newTag = ref('');
const formError = ref('');
const saving = ref(false);

// Live preview count
const previewCount = ref<number | null>(null);
const previewLoading = ref(false);

const audiencesComposable = useAudiences();

async function fetchPreviewCount() {
  if (!appId.value) {
    previewCount.value = null;
    return;
  }
  previewLoading.value = true;
  try {
    const filter: Record<string, string> = {};
    if (newPlatform.value) filter.platform = newPlatform.value;
    if (newProvider.value) filter.provider = newProvider.value;
    if (newTag.value.trim()) filter.tag = newTag.value.trim();
    previewCount.value = await audiencesComposable.previewCount(appId.value, filter as any);
  } catch {
    previewCount.value = null;
  } finally {
    previewLoading.value = false;
  }
}

// Debounce the preview count fetch as filter inputs change
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePreview() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchPreviewCount, 400);
}

watch([newPlatform, newProvider, newTag], () => {
  if (showForm.value) schedulePreview();
});

watch(showForm, (open) => {
  if (open) fetchPreviewCount();
  else previewCount.value = null;
});

async function createAudience() {
  if (!newName.value.trim()) {
    formError.value = 'Name is required';
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const body: Record<string, string> = { name: newName.value.trim() };
    if (newPlatform.value) body.platform = newPlatform.value;
    if (newProvider.value) body.provider = newProvider.value;
    if (newTag.value.trim()) body.tag = newTag.value.trim();
    await audiencesComposable.create(appId.value, body as any);
    newName.value = '';
    newPlatform.value = '';
    newProvider.value = '';
    newTag.value = '';
    showForm.value = false;
    await refresh();
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string };
    if (err.statusCode === 409) {
      formError.value = 'An audience with that name already exists for this app.';
    } else {
      formError.value = err.statusMessage ?? 'Failed to create audience';
    }
  } finally {
    saving.value = false;
  }
}

async function deleteAudience(id: string) {
  await audiencesComposable.remove(appId.value, id);
  await refresh();
}

function filterSummary(row: any): string {
  const parts: string[] = [];
  if (row.platform) parts.push(row.platform);
  if (row.provider) parts.push(row.provider);
  if (row.tag) parts.push(`#${row.tag}`);
  return parts.length > 0 ? parts.join(', ') : 'All devices';
}
</script>

<template>
  <div>
    <!-- Actions row -->
    <div class="page-head-actions" style="margin-bottom: 20px;">
      <button
        type="button"
        class="btn btn-primary"
        data-test="new-audience-btn"
        @click="showForm = !showForm"
      >+ New audience</button>
    </div>

    <!-- App ID filter -->
    <div class="filter-bar" style="margin-bottom: 16px;">
      <input
        v-model="appId"
        type="text"
        placeholder="Filter by App ID"
        class="filter-input"
        data-test="app-id-filter"
        @change="refresh()"
      />
    </div>

    <!-- Create form panel -->
    <div v-if="showForm" class="panel section-gap" style="margin-bottom: 20px;">
      <form data-test="create-audience-form" class="stack" @submit.prevent="createAudience">
        <p v-if="formError" class="form-error">{{ formError }}</p>

        <div class="field">
          <label class="field-label" for="audience-name">Name</label>
          <input
            id="audience-name"
            v-model="newName"
            type="text"
            placeholder="e.g. VIP Android users"
            data-test="audience-name"
          />
        </div>

        <div class="field">
          <label class="field-label" for="audience-platform">Platform (optional)</label>
          <select id="audience-platform" v-model="newPlatform" data-test="platform-select">
            <option value="">Any platform</option>
            <option value="android">Android</option>
            <option value="ios">iOS</option>
            <option value="huawei">Huawei</option>
            <option value="web">Web</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="audience-provider">Provider (optional)</label>
          <select id="audience-provider" v-model="newProvider" data-test="provider-select">
            <option value="">Any provider</option>
            <option value="fcm">FCM</option>
            <option value="huawei">Huawei</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="audience-tag">Tag (optional)</label>
          <input
            id="audience-tag"
            v-model="newTag"
            type="text"
            placeholder="e.g. vip"
            data-test="tag-input"
          />
        </div>

        <!-- Live count preview -->
        <div class="callout" data-test="preview-count">
          <span v-if="previewLoading" class="text-muted">Counting...</span>
          <span v-else-if="previewCount !== null">
            Estimated reach: <strong>{{ previewCount }}</strong> device{{ previewCount === 1 ? '' : 's' }}
          </span>
          <span v-else class="text-muted">Enter an App ID to preview reach.</span>
        </div>

        <div class="cluster">
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="saving"
            data-test="save-audience-btn"
          >{{ saving ? 'Saving...' : 'Save audience' }}</button>
          <button
            type="button"
            class="btn btn-ghost"
            @click="showForm = false"
          >Cancel</button>
        </div>
      </form>
    </div>

    <!-- Audiences table -->
    <div class="section-gap">
      <div v-if="!audiences || audiences.length === 0" class="empty">
        <p class="empty-message">No audiences yet.</p>
        <p class="empty-hint">Create an audience to group devices by platform, provider, or tag.</p>
        <button type="button" class="btn btn-primary" @click="showForm = true">+ New audience</button>
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Filter</th>
              <th>Devices</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in (audiences as any[])"
              :key="a.id"
              data-test="audience-row"
            >
              <td>{{ a.name }}</td>
              <td class="text-muted">{{ filterSummary(a) }}</td>
              <td>
                <span data-test="audience-count" class="badge badge-muted">{{ a.count }}</span>
              </td>
              <td class="text-muted">{{ a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '--' }}</td>
              <td>
                <button
                  type="button"
                  class="btn btn-danger"
                  data-test="delete-audience-btn"
                  @click="deleteAudience(a.id)"
                >Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
