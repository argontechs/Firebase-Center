<script setup lang="ts">
const route = useRoute();

const tabs = [
  { label: 'Devices', segment: '' },
  { label: 'Audiences', segment: 'audiences' },
] as const;

function isActive(segment: string) {
  if (segment === '') {
    return route.path === '/targets' || route.path === '/targets/';
  }
  return route.path === `/targets/${segment}`;
}
</script>

<template>
  <div>
    <!-- Tab navigation between Devices and Audiences -->
    <nav class="tab-strip" data-test="targets-tab-strip" style="margin-bottom: 24px;">
      <NuxtLink
        v-for="t in tabs"
        :key="t.segment"
        :to="t.segment === '' ? '/targets' : `/targets/${t.segment}`"
        class="tab-item"
        :class="{ active: isActive(t.segment) }"
        data-test="targets-tab"
      >{{ t.label }}</NuxtLink>
    </nav>

    <!-- Child page content -->
    <NuxtPage />
  </div>
</template>
