<script setup lang="ts">
import { useRoute } from 'vue-router';

interface App { id: string; companyId: string; name: string; notes: string | null; createdAt: string }

const route = useRoute();
const appId = route.params.id as string;
const { data: app } = await useFetch<App>(`/api/apps/${appId}`);

const tabs = [
  { label: 'Credentials', segment: 'credentials' },
  { label: 'Devices',     segment: 'devices' },
  { label: 'Ingest Keys', segment: 'ingest-keys' },
  { label: 'Compose',     segment: 'compose' },
  { label: 'History',     segment: 'history' },
] as const;

function isActive(segment: string) {
  return route.path.endsWith(`/${segment}`);
}
</script>

<template>
  <div>
    <div class="page-head">
      <div class="page-head-text">
        <h1 data-test="app-title" class="page-head-title">{{ app?.name }}</h1>
      </div>
    </div>

    <nav class="tab-strip" data-test="tab-strip">
      <NuxtLink
        v-for="t in tabs"
        :key="t.segment"
        :to="`/apps/${appId}/${t.segment}`"
        class="tab-item"
        data-test="app-tab"
        :class="{ active: isActive(t.segment) }"
      >{{ t.label }}</NuxtLink>
    </nav>

    <div data-test="tab-panel">
      <NuxtPage />
    </div>
  </div>
</template>
