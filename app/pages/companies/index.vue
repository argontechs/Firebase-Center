<script setup lang="ts">
import { ref } from 'vue';
import { useLabels } from '../../composables/useLabels';

interface Company { id: string; name: string; notes: string | null; status: 'active' | 'archived'; createdAt: string }

const labels = useLabels();
const { data: companies, refresh } = await useFetch<Company[]>('/api/companies', { default: () => [] });

const newName = ref('');
const showForm = ref(false);
async function createCompany() {
  if (!newName.value.trim()) return;
  await $fetch('/api/companies', { method: 'POST', body: { name: newName.value.trim() } });
  newName.value = '';
  showForm.value = false;
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
  <div>
    <div class="page-head">
      <div class="page-head-text">
        <h1 data-test="page-title" class="page-head-title">{{ labels.company.plural }}</h1>
        <p class="page-head-subtitle">Manage your sites and their apps.</p>
      </div>
      <div class="page-head-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-test="create-btn"
          @click="showForm = !showForm"
        >New {{ labels.company.singular }}</button>
      </div>
    </div>

    <!-- Create form panel -->
    <div v-if="showForm" class="panel section-gap">
      <form data-test="create-form" class="stack" @submit.prevent="createCompany">
        <div class="field">
          <label class="field-label" for="new-site-name">{{ labels.company.singular }} name</label>
          <input
            id="new-site-name"
            v-model="newName"
            type="text"
            :placeholder="`New ${labels.company.singular} name`"
            data-test="create-input"
          />
        </div>
        <div class="cluster">
          <button type="submit" class="btn btn-primary" data-test="create-submit">Add {{ labels.company.singular }}</button>
          <button type="button" class="btn btn-ghost" @click="showForm = false">Cancel</button>
        </div>
      </form>
    </div>

    <!-- Sites table -->
    <div class="section-gap">
      <div v-if="!companies || companies.length === 0" class="empty">
        <p class="empty-message">No {{ labels.company.plural.toLowerCase() }} yet.</p>
        <p class="empty-hint">Create your first {{ labels.company.singular.toLowerCase() }} to get started.</p>
        <button type="button" class="btn btn-primary" @click="showForm = true">New {{ labels.company.singular }}</button>
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in companies" :key="c.id" data-test="company-row">
              <td>
                <template v-if="editingId === c.id">
                  <div class="cluster">
                    <input v-model="editName" data-test="edit-input" type="text" style="width: auto; flex: 1;" />
                    <button type="button" class="btn btn-primary" data-test="save-btn" @click="saveEdit(c.id)">Save</button>
                    <button type="button" class="btn btn-ghost" @click="editingId = null">Cancel</button>
                  </div>
                </template>
                <template v-else>
                  <NuxtLink :to="`/companies/${c.id}/apps`" data-test="company-name">{{ c.name }}</NuxtLink>
                </template>
              </td>
              <td>
                <span
                  data-test="company-status"
                  class="badge"
                  :class="c.status === 'active' ? 'badge-ok' : 'badge-muted'"
                >{{ c.status }}</span>
              </td>
              <td>
                <div v-if="editingId !== c.id" class="cluster" style="justify-content: flex-end;">
                  <button type="button" class="btn btn-ghost" data-test="edit-btn" @click="startEdit(c)">Rename</button>
                  <button
                    type="button"
                    class="btn btn-ghost"
                    data-test="toggle-btn"
                    @click="toggleStatus(c)"
                  >{{ c.status === 'active' ? 'Archive' : 'Activate' }}</button>
                  <button type="button" class="btn btn-danger" data-test="delete-btn" @click="removeCompany(c.id)">Delete</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
