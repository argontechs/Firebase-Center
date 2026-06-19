export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return;
  const { data } = await useFetch('/api/auth/me', { key: 'auth-me' });
  const me = data.value as { user: { id: string }; mustChangePassword: boolean } | null;
  if (!me) return navigateTo('/login');
  if (me.mustChangePassword && to.path !== '/login') return navigateTo('/login?change=1');
});
