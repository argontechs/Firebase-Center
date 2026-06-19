import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  test: { environment: 'node', include: ['test/**/*.test.ts', 'server/**/*.test.ts', 'app/**/*.test.ts'], globals: false, hookTimeout: 30000 },
  resolve: {
    alias: {
      // Nuxt rootDir aliases (~~/@@). Server-to-server imports use ~~/server/* so they resolve
      // to the project root in BOTH Vitest and the Nitro production build (where ~ = app/ srcDir).
      '~~': new URL('./', import.meta.url).pathname,
      '@@': new URL('./', import.meta.url).pathname,
      '~': new URL('./', import.meta.url).pathname,
      '@': new URL('./', import.meta.url).pathname,
      // Stub Nuxt's virtual #imports so server code importing useRuntimeConfig can run under Vitest.
      '#imports': new URL('./server/test/imports-stub.ts', import.meta.url).pathname,
      // Stub @nuxt/test-utils/runtime so component tests can import mountSuspended without
      // requiring a full Nuxt build artifact (#build/root-component.mjs).
      // mountSuspended is aliased to mount from @vue/test-utils (happy-dom environment).
      '@nuxt/test-utils/runtime': new URL('./test/nuxt-test-utils-runtime-stub.ts', import.meta.url).pathname,
    },
  },
});
