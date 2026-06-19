import { ref } from 'vue';

const CSRF_HEADER_NAME = 'x-csrf-token';

export function useCsrf() {
  const token = ref('');
  async function fetchToken(): Promise<void> {
    const res = await $fetch<{ token: string }>('/api/auth/csrf');
    token.value = res.token;
  }
  function headers(): Record<string, string> {
    return token.value ? { [CSRF_HEADER_NAME]: token.value } : {};
  }
  return { token, fetchToken, headers };
}
