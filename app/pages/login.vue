<script setup lang="ts">
definePageMeta({ layout: false });

const route = useRoute();
const csrf = useCsrf();
const mode = ref<'login' | 'change'>(route.query.change === '1' ? 'change' : 'login');
const email = ref('');
const password = ref('');
const currentPassword = ref('');
const newPassword = ref('');
const error = ref('');

async function submitLogin() {
  error.value = '';
  try {
    const res = await $fetch<{ mustChangePassword: boolean }>('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
    if (res.mustChangePassword) { currentPassword.value = password.value; mode.value = 'change'; }
    else await navigateTo('/');
  } catch (e: any) {
    error.value = e?.statusCode === 429 ? 'Too many attempts. Try again later.' : 'Invalid credentials.';
  }
}

async function submitChange() {
  error.value = '';
  try {
    await csrf.fetchToken();
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      headers: csrf.headers(),
      body: { currentPassword: currentPassword.value, newPassword: newPassword.value },
    });
    await navigateTo('/');
  } catch (e: any) {
    error.value = e?.data?.message ?? 'Password did not meet requirements.';
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-panel">
      <!-- Wordmark -->
      <div class="login-wordmark">
        <span class="login-wordmark-dot" aria-hidden="true"></span>
        Firebase Center
      </div>

      <!-- Sign in form -->
      <template v-if="mode === 'login'">
        <h1 class="login-title">Sign in</h1>
        <form class="login-form" @submit.prevent="submitLogin" novalidate>
          <div class="field">
            <label for="login-email">Email</label>
            <input
              id="login-email"
              v-model="email"
              type="email"
              autocomplete="email"
              required
              placeholder="you@example.com"
            />
          </div>
          <div class="field">
            <label for="login-password">Password</label>
            <input
              id="login-password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              placeholder="Password"
            />
          </div>
          <p v-if="error" class="login-error" role="alert">{{ error }}</p>
          <button type="submit" class="btn btn-primary login-submit">Sign in</button>
        </form>
      </template>

      <!-- Change password form -->
      <template v-else>
        <h1 class="login-title">Set a new password</h1>
        <p class="login-subtitle">You must set a new password before continuing.</p>
        <form class="login-form" @submit.prevent="submitChange" novalidate>
          <div class="field">
            <label for="cp-current">Current password</label>
            <input
              id="cp-current"
              v-model="currentPassword"
              type="password"
              autocomplete="current-password"
              required
              placeholder="Current password"
            />
          </div>
          <div class="field">
            <label for="cp-new">New password</label>
            <input
              id="cp-new"
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              required
              placeholder="New password (12+ chars, mixed)"
            />
          </div>
          <p v-if="error" class="login-error" role="alert">{{ error }}</p>
          <button type="submit" class="btn btn-primary login-submit">Set new password</button>
        </form>
      </template>
    </div>
  </div>
</template>

<style scoped>
.login-wordmark {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--t-sm);
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
  margin-bottom: 24px;
}

.login-wordmark-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.login-submit {
  width: 100%;
  margin-top: 4px;
}
</style>
