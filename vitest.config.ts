import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['server/**/*.test.ts', 'app/**/*.test.ts'], globals: false, hookTimeout: 30000 },
  resolve: { alias: { '~': new URL('./', import.meta.url).pathname } },
});
