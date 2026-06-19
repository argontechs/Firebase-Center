export default defineNuxtConfig({
  compatibilityDate: '2026-06-01',
  future: { compatibilityVersion: 4 },
  ssr: true,
  runtimeConfig: {
    // server-only secrets (never sent to the client)
    databaseUrl: '',          // NUXT_DATABASE_URL
    boMasterKey: '',          // NUXT_BO_MASTER_KEY
    sessionPassword: '',      // NUXT_SESSION_PASSWORD
    allowedOrigins: (process.env.BO_ALLOWED_ORIGINS ?? 'https://localhost:3000').split(','),
    boAdminEmail: '',         // NUXT_BO_ADMIN_EMAIL
    boAdminPassword: '',      // NUXT_BO_ADMIN_PASSWORD
    public: {
      // non-secret only
      appName: 'Firebase Center',
    },
  },
});
