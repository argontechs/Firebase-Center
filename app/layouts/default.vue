<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const csrf = useCsrf();

interface MeResponse {
  user: { id: string; email: string; role: string };
  mustChangePassword: boolean;
}

const { data: me } = await useFetch<MeResponse>('/api/auth/me', { key: 'auth-me' });
const userEmail = computed(() => me.value?.user?.email ?? '');

// Global nav. Compose + Send history are per-app (reached from a Site's App),
// so the global menu links the top-level destinations that actually exist.
const navItems = [
  { label: 'Sites',               to: '/companies'          },
  { label: 'Import credentials',  to: '/imports/credentials' },
] as const;

function isActive(to: string): boolean {
  if (to === '/companies') {
    return route.path === '/companies' || route.path.startsWith('/companies/');
  }
  return route.path === to || route.path.startsWith(to + '/');
}

const signingOut = ref(false);
async function signOut() {
  if (signingOut.value) return;
  signingOut.value = true;
  try {
    await csrf.fetchToken();
    await $fetch('/api/auth/logout', { method: 'POST', headers: csrf.headers() });
  } catch {
    // session may already be gone — proceed to redirect
  } finally {
    signingOut.value = false;
    await navigateTo('/login');
  }
}
</script>

<template>
  <div class="app-shell">
    <!-- ── Sidebar ── -->
    <aside class="sidebar">
      <div class="sidebar-wordmark">
        <span class="sidebar-wordmark-dot" aria-hidden="true"></span>
        Firebase Center
      </div>

      <nav class="sidebar-nav" aria-label="Main navigation">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="sidebar-nav-item"
          :class="{ active: isActive(item.to) }"
          :aria-current="isActive(item.to) ? 'page' : undefined"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="sidebar-footer">
        <span class="sidebar-footer-email">{{ userEmail }}</span>
        <button
          class="btn btn-ghost"
          :disabled="signingOut"
          style="font-size: var(--t-xs); padding: 6px 10px;"
          @click="signOut"
        >
          {{ signingOut ? 'Signing out...' : 'Sign out' }}
        </button>
      </div>
    </aside>

    <!-- ── Main area ── -->
    <div class="main-area">
      <!-- Topbar -->
      <header class="topbar">
        <div class="topbar-title">
          <slot name="title" />
        </div>
        <div class="topbar-actions">
          <slot name="actions" />
        </div>
      </header>

      <!-- Page content -->
      <main class="main-content">
        <slot />
      </main>
    </div>
  </div>
</template>
