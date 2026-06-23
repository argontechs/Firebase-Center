<script setup lang="ts">
import { ref, computed } from 'vue';
import { useHistory } from '~/composables/useHistory';

const route = useRoute();
const appFilter = ref<string>(String(route.query.appId ?? ''));

function buildQuery() {
  const qs = appFilter.value ? `?appId=${encodeURIComponent(appFilter.value)}` : '';
  return `/api/campaigns${qs}`;
}

const { data: rawCampaigns, refresh } = await useFetch(buildQuery, { default: () => [] });

const campaigns = computed(() => (rawCampaigns.value as Record<string, unknown>[]) ?? []);

const historyComposable = useHistory();

const cancelingId = ref<string | null>(null);
const cancelError = ref('');

async function cancelCampaign(id: string) {
  cancelError.value = '';
  cancelingId.value = id;
  try {
    await historyComposable.cancel(id);
    await refresh();
  } catch (e: unknown) {
    const err = e as { statusMessage?: string };
    cancelError.value = err.statusMessage ?? 'Cancel failed';
  } finally {
    cancelingId.value = null;
  }
}

async function applyFilter() {
  await refresh();
}

function formatDate(d: string | null) {
  if (!d) return '--';
  return new Date(d).toLocaleString();
}

function statusClass(status: string) {
  if (status === 'done' || status === 'sent') return 'badge-ok';
  if (status === 'failed' || status === 'invalid' || status === 'canceled') return 'badge-danger';
  if (status === 'gave_up') return 'badge-warn';
  if (status === 'scheduled' || status === 'queued' || status === 'sending') return 'badge-muted';
  return 'badge-muted';
}
</script>

<template>
  <div>
    <!-- Page header -->
    <div class="page-head">
      <div class="page-head-text">
        <h1 data-test="history-title" class="page-head-title">History</h1>
        <p class="page-head-subtitle">All push campaigns, including scheduled and past sends.</p>
      </div>
    </div>

    <!-- Filter bar -->
    <div class="filter-bar section-gap">
      <input
        v-model="appFilter"
        type="text"
        placeholder="Filter by App ID"
        class="filter-input"
        data-test="app-filter"
        @change="applyFilter"
      />
    </div>

    <!-- Error callout -->
    <div v-if="cancelError" class="callout" role="alert" style="margin-bottom: 16px;">
      {{ cancelError }}
    </div>

    <!-- Empty state -->
    <div v-if="!campaigns || campaigns.length === 0" class="empty" data-test="empty-history">
      <p class="empty-message">No campaigns found.</p>
      <p class="empty-hint">Send your first push from the Send page.</p>
      <NuxtLink to="/send" class="btn btn-primary">Send a push</NuxtLink>
    </div>

    <!-- Campaigns table -->
    <div v-else class="table-wrap section-gap">
      <table class="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>App</th>
            <th>Status</th>
            <th>When</th>
            <th>Sent</th>
            <th>Failed</th>
            <th>Invalid</th>
            <th>Gave up</th>
            <th>Broadcast</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in (campaigns as any[])"
            :key="c.id"
            data-test="campaign-row"
          >
            <td>{{ c.title }}</td>
            <td data-test="app-name">{{ c.appName ?? c.appId ?? '--' }}</td>
            <td>
              <span
                class="badge"
                :class="statusClass(c.status)"
                data-test="status-badge"
              >{{ c.status }}</span>
            </td>
            <td class="text-muted" style="white-space: nowrap;">
              <template v-if="c.status === 'scheduled' && c.scheduledAt">
                <span>Scheduled for {{ formatDate(c.scheduledAt) }}</span>
              </template>
              <template v-else>
                {{ formatDate(c.createdAt) }}
              </template>
            </td>
            <td>
              <span v-if="c.counts?.sent > 0" class="badge badge-ok" data-test="count-badge">{{ c.counts.sent }} sent</span>
              <span v-else class="text-faint">--</span>
            </td>
            <td>
              <span v-if="c.counts?.failed > 0" class="badge badge-danger" data-test="count-badge">{{ c.counts.failed }} failed</span>
              <span v-else class="text-faint">--</span>
            </td>
            <td>
              <span v-if="c.counts?.invalid > 0" class="badge badge-danger" data-test="count-badge">{{ c.counts.invalid }} invalid</span>
              <span v-else class="text-faint">--</span>
            </td>
            <td>
              <span v-if="c.counts?.gave_up > 0" class="badge badge-warn" data-test="count-badge">{{ c.counts.gave_up }} gave up</span>
              <span v-else class="text-faint">--</span>
            </td>
            <td class="mono text-muted" style="font-size: var(--t-xs);">
              {{ c.broadcastId ? c.broadcastId.slice(0, 8) + '...' : '--' }}
            </td>
            <td>
              <button
                v-if="c.status === 'scheduled'"
                type="button"
                class="btn btn-danger"
                :disabled="cancelingId === c.id"
                data-test="cancel-campaign"
                @click="cancelCampaign(c.id)"
              >{{ cancelingId === c.id ? 'Canceling...' : 'Cancel' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
