/**
 * Minimal stub for `@nuxt/test-utils/runtime` so that component tests can
 * import `mountSuspended` without requiring a full Nuxt build artifact
 * (`#build/root-component.mjs`) that the real package depends on.
 *
 * `mountSuspended` is aliased to `mount` from `@vue/test-utils`, which is
 * sufficient for the happy-dom vitest environment used in this project.
 * The alias is registered in `vitest.config.ts`.
 *
 * Spec reference: M4.8 — "Uses `@nuxt/test-utils` `mountSuspended` (M1 component-test setup)".
 */
export { mount as mountSuspended, flushPromises } from '@vue/test-utils';
