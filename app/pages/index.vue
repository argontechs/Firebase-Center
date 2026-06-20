<script setup lang="ts">
// Root path → Sites (the app's home). Avoids a 404 on "/" after login.
definePageMeta({ layout: false });
await navigateTo('/companies', { replace: true });
</script>

<template>
  <div />
</template>
