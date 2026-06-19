<script setup lang="ts">
import { ref } from 'vue';
import { useLabels } from '../../composables/useLabels';

interface Company { id: string; name: string; notes: string | null; status: 'active' | 'archived'; createdAt: string }

const labels = useLabels();
const { data: companies, refresh } = await useFetch<Company[]>('/api/companies', { default: () => [] });

const newName = ref('');
async function createCompany() {
  if (!newName.value.trim()) return;
  await $fetch('/api/companies', { method: 'POST', body: { name: newName.value.trim() } });
  newName.value = '';
  await refresh();
}

const editingId = ref<string | null>(null);
const editName = ref('');
function startEdit(c: Company) { editingId.value = c.id; editName.value = c.name; }
async function saveEdit(id: string) {
  await $fetch(`/api/companies/${id}`, { method: 'PATCH', body: { name: editName.value.trim() } });
  editingId.value = null;
  await refresh();
}
async function toggleStatus(c: Company) {
  await $fetch(`/api/companies/${c.id}`, { method: 'PATCH', body: { status: c.status === 'active' ? 'archived' : 'active' } });
  await refresh();
}
async function removeCompany(id: string) {
  await $fetch(`/api/companies/${id}`, { method: 'DELETE' });
  await refresh();
}
</script>

<template>
  <section>
    <h1 data-test="page-title">{{ labels.company.plural }}</h1>

    <form data-test="create-form" @submit.prevent="createCompany">
      <input v-model="newName" :placeholder="`New ${labels.company.singular} name`" data-test="create-input" />
      <button type="submit" data-test="create-btn">Add {{ labels.company.singular }}</button>
    </form>

    <ul>
      <li v-for="c in companies" :key="c.id" data-test="company-row">
        <template v-if="editingId === c.id">
          <input v-model="editName" data-test="edit-input" />
          <button data-test="save-btn" @click="saveEdit(c.id)">Save</button>
        </template>
        <template v-else>
          <NuxtLink :to="`/companies/${c.id}/apps`" data-test="company-name">{{ c.name }}</NuxtLink>
          <span data-test="company-status">{{ c.status }}</span>
          <button data-test="edit-btn" @click="startEdit(c)">Rename</button>
          <button data-test="toggle-btn" @click="toggleStatus(c)">{{ c.status === 'active' ? 'Archive' : 'Activate' }}</button>
          <button data-test="delete-btn" @click="removeCompany(c.id)">Delete</button>
        </template>
      </li>
    </ul>
  </section>
</template>
