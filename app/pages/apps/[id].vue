<script setup lang="ts">
import { useRoute } from 'vue-router';

interface App { id: string; companyId: string; name: string; notes: string | null; createdAt: string }

const route = useRoute();
const appId = route.params.id as string;
const { data: app } = await useFetch<App>(`/api/apps/${appId}`);

const tabs = [
  { label: 'Credentials', segment: 'credentials' },
  { label: 'Ingest Keys', segment: 'ingest-keys' },
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
      <div class="page-head-actions">
        <NuxtLink
          :to="`/targets?appId=${appId}`"
          class="btn btn-ghost"
          data-test="quick-link-targets"
        >View targets</NuxtLink>
        <NuxtLink
          :to="`/send?appId=${appId}`"
          class="btn btn-ghost"
          data-test="quick-link-send"
        >Send to this app</NuxtLink>
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
