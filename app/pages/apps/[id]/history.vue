<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

defineOptions({ name: 'HistoryPage' });

const route = useRoute();
const appId = computed(() => String(route.params.id));

interface Counts { sent: number; failed: number; invalid: number; gave_up: number; not_ready: number }
interface Summary { id: string; title: string; status: string; createdAt: string; counts: Counts }
interface Delivery { id: string; token: string; provider: string; platform: string; status: string; disposition: string | null; errorCode: string | null }

const campaigns = ref<Summary[]>([]);
const selected = ref<string | null>(null);
const deliveries = ref<Delivery[]>([]);

async function load() {
  campaigns.value = await $fetch<Summary[]>(`/api/campaigns?appId=${appId.value}`);
}

async function openCampaign(id: string) {
  selected.value = id;
  const res = await $fetch<{ deliveries: Delivery[] }>(`/api/campaigns/${id}`);
  deliveries.value = res.deliveries;
}

onMounted(load);

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'sent':
    case 'done':
      return 'badge badge-ok';
    case 'failed':
    case 'invalid':
      return 'badge badge-danger';
    case 'gave_up':
    case 'not_ready':
      return 'badge badge-warn';
    default:
      return 'badge badge-muted';
  }
}

function deliveryBadgeClass(status: string): string {
  switch (status) {
    case 'sent':
      return 'badge badge-ok';
    case 'failed':
    case 'invalid':
      return 'badge badge-danger';
    case 'gave_up':
    case 'not_ready':
      return 'badge badge-warn';
    default:
      return 'badge badge-muted';
  }
}
</script>

<template>
  <div class="history-page">
    <div class="page-head">
      <div class="page-head-text">
        <h2 class="page-head-title">History</h2>
        <p class="page-head-subtitle">Campaigns sent from this app, with per-device delivery counts.</p>
      </div>
    </div>

    <!-- Campaigns table -->
    <div v-if="campaigns.length > 0" class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>sent</th>
            <th>failed</th>
            <th>invalid</th>
            <th>gave up</th>
            <th>not ready</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in campaigns"
            :key="c.id"
            :data-test="`campaign-${c.id}`"
            class="history-campaign-row"
            @click="openCampaign(c.id)"
          >
            <td class="history-title-cell">{{ c.title }}</td>
            <td>
              <span :class="statusBadgeClass(c.status)">{{ c.status }}</span>
            </td>
            <td data-test="count-sent">
              <span v-if="c.counts.sent > 0" class="badge badge-ok">{{ c.counts.sent }}</span>
              <span v-else class="text-faint text-xs">0</span>
            </td>
            <td data-test="count-failed">
              <span v-if="c.counts.failed > 0" class="badge badge-danger">{{ c.counts.failed }}</span>
              <span v-else class="text-faint text-xs">0</span>
            </td>
            <td data-test="count-invalid">
              <span v-if="c.counts.invalid > 0" class="badge badge-danger">{{ c.counts.invalid }}</span>
              <span v-else class="text-faint text-xs">0</span>
            </td>
            <td data-test="count-gave_up">
              <span v-if="c.counts.gave_up > 0" class="badge badge-warn">{{ c.counts.gave_up }}</span>
              <span v-else class="text-faint text-xs">0</span>
            </td>
            <td data-test="count-not_ready">
              <span v-if="c.counts.not_ready > 0" class="badge badge-warn">{{ c.counts.not_ready }}</span>
              <span v-else class="text-faint text-xs">0</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="empty">
      <p class="empty-message">No campaigns sent yet.</p>
      <p class="empty-hint">Use Compose to send your first message to this app's devices.</p>
    </div>

    <!-- Per-device drill-in -->
    <div v-if="selected" class="detail section-gap" data-test="detail">
      <div class="page-head" style="margin-bottom: 16px;">
        <div class="page-head-text">
          <h2>Per-device results</h2>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Provider</th>
              <th>Platform</th>
              <th>Status</th>
              <th>Disposition</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in deliveries" :key="d.id" :data-test="`delivery-${d.id}`">
              <td class="mono history-token-cell">{{ d.token }}</td>
              <td class="mono">{{ d.provider }}</td>
              <td class="mono">{{ d.platform }}</td>
              <td>
                <span :class="deliveryBadgeClass(d.status)">{{ d.status }}</span>
              </td>
              <td class="text-muted text-sm">{{ d.disposition ?? '' }}</td>
              <td>
                <span v-if="d.errorCode" class="mono text-danger text-xs">{{ d.errorCode }}</span>
                <span v-else class="text-faint text-xs">none</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-campaign-row {
  cursor: pointer;
}

.history-title-cell {
  font-weight: 550;
}

.history-token-cell {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
