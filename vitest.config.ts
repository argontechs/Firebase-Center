import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts', 'server/**/*.test.ts', 'app/**/*.test.ts'], globals: false, hookTimeout: 30000 },
  resolve: {
    alias: {
      '~': new URL('./', import.meta.url).pathname,
      // Stub Nuxt's virtual #imports so server code importing useRuntimeConfig can run under Vitest.
      '#imports': new URL('./server/test/imports-stub.ts', import.meta.url).pathname,
    },
  },
});
