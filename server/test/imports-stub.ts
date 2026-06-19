/**
 * Minimal stub for Nuxt's virtual `#imports` module so that server code
 * (e.g. server/middleware/auth.ts, server/utils/auth/guard.ts) can be
 * imported and executed under Vitest without a running Nuxt runtime.
 *
 * `useRuntimeConfig` returns the config shape that auth middleware + guards need.
 * Individual test files that need different values can `vi.mock('#imports', ...)`.
 */
export function useRuntimeConfig() {
  return {
    allowedOrigins: (process.env.BO_ALLOWED_ORIGINS ?? 'http://localhost:3000').split(','),
  };
}

// Re-export ref so composable tests that import from '#imports' get a real ref.
export { ref } from 'vue';
