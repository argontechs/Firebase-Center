// Vitest global setup — runs in each worker BEFORE any test module (and thus before
// server/db/client.ts, which throws at import when NUXT_DATABASE_URL is unset).
// Defaults point at the local throwaway test Postgres (docker fc-test-db on :55432).
// Each value is only set when absent, so CI / a custom env still wins.
process.env.NUXT_DATABASE_URL ||= 'postgres://fc:fc@localhost:55432/firebase_center_test';
process.env.NUXT_BO_MASTER_KEY ||= '1:R9mc6Tk1PgDnyHPhrOEHLt+UjY7wwcyVGNqMtJhWdI8=';
process.env.NUXT_SESSION_PASSWORD ||= 'test_session_password_at_least_32_chars_long_xx';
process.env.NUXT_BO_ADMIN_EMAIL ||= 'admin@test.local';
process.env.NUXT_BO_ADMIN_PASSWORD ||= 'TestAdmin!2026xyz';
