<script setup lang="ts">
const route = useRoute();
await navigateTo(`/apps/${route.params.id}/credentials`, { replace: true });
</script>
