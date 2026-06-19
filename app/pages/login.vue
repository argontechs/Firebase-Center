<script setup lang="ts">
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
  await csrf.fetchToken();
  try {
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
  <main>
    <form v-if="mode === 'login'" @submit.prevent="submitLogin">
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Password" required />
      <button type="submit">Sign in</button>
    </form>
    <form v-else @submit.prevent="submitChange">
      <p>You must set a new password before continuing.</p>
      <input v-model="currentPassword" type="password" placeholder="Current password" required />
      <input v-model="newPassword" type="password" placeholder="New password (12+ chars, mixed)" required />
      <button type="submit">Set new password</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
  </main>
</template>
