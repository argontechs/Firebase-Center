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
</script>

<template>
  <section class="history">
    <h1>History</h1>
    <table>
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
          style="cursor: pointer"
          @click="openCampaign(c.id)"
        >
          <td>{{ c.title }}</td>
          <td>{{ c.status }}</td>
          <td data-test="count-sent">{{ c.counts.sent }}</td>
          <td data-test="count-failed">{{ c.counts.failed }}</td>
          <td data-test="count-invalid">{{ c.counts.invalid }}</td>
          <td data-test="count-gave_up">{{ c.counts.gave_up }}</td>
          <td data-test="count-not_ready">{{ c.counts.not_ready }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="selected" class="detail" data-test="detail">
      <h2>Per-device results</h2>
      <table>
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
            <td>{{ d.token }}</td>
            <td>{{ d.provider }}</td>
            <td>{{ d.platform }}</td>
            <td>{{ d.status }}</td>
            <td>{{ d.disposition }}</td>
            <td>{{ d.errorCode }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
