<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { useLabels } from '../../../composables/useLabels';

interface App { id: string; companyId: string; name: string; notes: string | null; createdAt: string }
interface Company { id: string; name: string; status: string }

const labels = useLabels();
const route = useRoute();
const companyId = route.params.id as string;

const { data: company } = await useFetch<Company>(`/api/companies/${companyId}`);
const { data: apps, refresh } = await useFetch<App[]>('/api/apps', { query: { companyId }, default: () => [] });

const newName = ref('');
async function createApp() {
  if (!newName.value.trim()) return;
  await $fetch('/api/apps', { method: 'POST', body: { companyId, name: newName.value.trim() } });
  newName.value = '';
  await refresh();
}
async function removeApp(id: string) {
  await $fetch(`/api/apps/${id}`, { method: 'DELETE' });
  await refresh();
}
</script>

<template>
  <section>
    <p data-test="breadcrumb">
      <NuxtLink to="/companies">{{ labels.company.plural }}</NuxtLink>
      / <span data-test="company-name">{{ company?.name }}</span>
    </p>
    <h1 data-test="apps-title">{{ labels.app.plural }}</h1>

    <form data-test="create-app-form" @submit.prevent="createApp">
      <input v-model="newName" :placeholder="`New ${labels.app.singular} name`" data-test="create-app-input" />
      <button type="submit" data-test="create-app-btn">Add {{ labels.app.singular }}</button>
    </form>

    <ul>
      <li v-for="a in apps" :key="a.id" data-test="app-row">
        <NuxtLink :to="`/apps/${a.id}`" data-test="app-link">{{ a.name }}</NuxtLink>
        <button data-test="delete-app-btn" @click="removeApp(a.id)">Delete</button>
      </li>
    </ul>
  </section>
</template>
