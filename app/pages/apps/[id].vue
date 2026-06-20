<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';

interface App { id: string; companyId: string; name: string; notes: string | null; createdAt: string }

const route = useRoute();
const appId = route.params.id as string;
const { data: app } = await useFetch<App>(`/api/apps/${appId}`);

// Tabs whose panels are delivered in later milestones (M3 credentials, M4 devices/ingest-keys, M6 compose/history).
const tabs = ['Credentials', 'Devices', 'Ingest Keys', 'Compose', 'History'] as const;
const activeTab = ref<(typeof tabs)[number]>('Credentials');
</script>

<template>
  <div>
    <div class="page-head">
      <div class="page-head-text">
        <h1 data-test="app-title" class="page-head-title">{{ app?.name }}</h1>
      </div>
    </div>

    <nav class="tab-strip" data-test="tab-strip">
      <button
        v-for="t in tabs"
        :key="t"
        class="tab-item"
        data-test="app-tab"
        :class="{ active: activeTab === t }"
        @click="activeTab = t"
      >{{ t }}</button>
    </nav>

    <div data-test="tab-panel">
      <div class="empty">
        <p class="empty-message">{{ activeTab }}: Coming soon</p>
        <p class="empty-hint">This section will be available in a future update.</p>
      </div>
    </div>
  </div>
</template>
