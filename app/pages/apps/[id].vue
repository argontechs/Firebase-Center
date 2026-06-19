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
  <section>
    <h1 data-test="app-title">{{ app?.name }}</h1>

    <nav data-test="tab-strip">
      <button
        v-for="t in tabs"
        :key="t"
        data-test="app-tab"
        :class="{ active: activeTab === t }"
        @click="activeTab = t"
      >{{ t }}</button>
    </nav>

    <div data-test="tab-panel">
      <p>{{ activeTab }} — Coming soon</p>
    </div>
  </section>
</template>
