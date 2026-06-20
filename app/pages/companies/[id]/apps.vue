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
const showForm = ref(false);
async function createApp() {
  if (!newName.value.trim()) return;
  await $fetch('/api/apps', { method: 'POST', body: { companyId, name: newName.value.trim() } });
  newName.value = '';
  showForm.value = false;
  await refresh();
}
async function removeApp(id: string) {
  await $fetch(`/api/apps/${id}`, { method: 'DELETE' });
  await refresh();
}
</script>

<template>
  <div>
    <!-- Breadcrumb -->
    <nav class="breadcrumb" data-test="breadcrumb">
      <NuxtLink to="/companies">{{ labels.company.plural }}</NuxtLink>
      <span class="breadcrumb-sep">/</span>
      <span data-test="company-name">{{ company?.name }}</span>
    </nav>

    <!-- Page header -->
    <div class="page-head">
      <div class="page-head-text">
        <h1 data-test="apps-title" class="page-head-title">{{ labels.app.plural }}</h1>
        <p class="page-head-subtitle">Apps under {{ company?.name }}.</p>
      </div>
      <div class="page-head-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-test="create-app-btn"
          @click="showForm = !showForm"
        >New {{ labels.app.singular }}</button>
      </div>
    </div>

    <!-- Create app form panel -->
    <div v-if="showForm" class="panel section-gap">
      <form data-test="create-app-form" class="stack" @submit.prevent="createApp">
        <div class="field">
          <label class="field-label" for="new-app-name">{{ labels.app.singular }} name</label>
          <input
            id="new-app-name"
            v-model="newName"
            type="text"
            :placeholder="`New ${labels.app.singular} name`"
            data-test="create-app-input"
          />
        </div>
        <div class="cluster">
          <button type="submit" class="btn btn-primary">Add {{ labels.app.singular }}</button>
          <button type="button" class="btn btn-ghost" @click="showForm = false">Cancel</button>
        </div>
      </form>
    </div>

    <!-- Apps table -->
    <div class="section-gap">
      <div v-if="!apps || apps.length === 0" class="empty">
        <p class="empty-message">No {{ labels.app.plural.toLowerCase() }} yet.</p>
        <p class="empty-hint">Add your first {{ labels.app.singular.toLowerCase() }} to start sending notifications.</p>
        <button type="button" class="btn btn-primary" @click="showForm = true">New {{ labels.app.singular }}</button>
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in apps" :key="a.id" data-test="app-row">
              <td>
                <NuxtLink :to="`/apps/${a.id}`" data-test="app-link">{{ a.name }}</NuxtLink>
              </td>
              <td style="text-align: right;">
                <button type="button" class="btn btn-danger" data-test="delete-app-btn" @click="removeApp(a.id)">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
