// @vitest-environment happy-dom
/**
 * Nav test — no layout test harness exists in this project (layouts are never
 * mounted in component tests), so we mount default.vue directly to assert the
 * five top-level nav entries introduced/updated in Task G1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, h, nextTick, Suspense } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';

// Stub useFetch (used by default.vue for /api/auth/me)
vi.stubGlobal('useFetch', (_url: string) => ({
  data: ref({ user: { id: 'u1', email: 'test@example.com', role: 'admin' }, mustChangePassword: false }),
  refresh: vi.fn(),
}));

vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}));

// Stub navigateTo (used by signOut in default.vue)
vi.stubGlobal('navigateTo', vi.fn());

// Stub useCsrf
vi.stubGlobal('useCsrf', () => ({
  token: { value: 'tok' },
  fetchToken: vi.fn(async () => {}),
  headers: vi.fn(() => ({ 'x-csrf-token': 'tok' })),
}));

// NuxtLink stub: renders an <a> with href so we can inspect nav links.
const NuxtLink = defineComponent({
  name: 'NuxtLink',
  props: { to: { type: [String, Object] } },
  setup(props, { slots }) {
    return () => h('a', { href: String(props.to), class: 'nav-link' }, slots.default?.());
  },
});

// Import AFTER globals are stubbed.
import DefaultLayout from '../layouts/default.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  });
}

async function mountLayout() {
  const router = makeRouter();
  await router.push('/companies');
  await router.isReady();

  // default.vue uses `await useFetch(...)` (async setup), so it needs a <Suspense> wrapper
  // — same pattern used in app-detail.test.ts.
  const wrapper = mount(
    defineComponent({
      setup() { return () => h(Suspense, null, { default: () => h(DefaultLayout as any, null, { default: () => h('div', { 'data-slot': 'content' }) }) }); },
    }),
    {
      global: {
        plugins: [router],
        components: { NuxtLink },
        stubs: { NuxtLink },
      },
    },
  );
  await nextTick();
  await nextTick();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('default layout — navigation', () => {
  it('renders exactly five top-level nav items', async () => {
    const wrapper = await mountLayout();
    const items = wrapper.findAll('.sidebar-nav-item');
    expect(items).toHaveLength(5);
  });

  it('includes a "Sites" link to /companies', async () => {
    const wrapper = await mountLayout();
    const labels = wrapper.findAll('.sidebar-nav-item').map((a) => a.text());
    expect(labels).toContain('Sites');
    const link = wrapper.findAll('.sidebar-nav-item').find((a) => a.text() === 'Sites');
    expect(link?.attributes('href')).toBe('/companies');
  });

  it('includes a "Targets" link to /targets', async () => {
    const wrapper = await mountLayout();
    const link = wrapper.findAll('.sidebar-nav-item').find((a) => a.text() === 'Targets');
    expect(link).toBeTruthy();
    expect(link?.attributes('href')).toBe('/targets');
  });

  it('includes a "Send" link to /send', async () => {
    const wrapper = await mountLayout();
    const link = wrapper.findAll('.sidebar-nav-item').find((a) => a.text() === 'Send');
    expect(link).toBeTruthy();
    expect(link?.attributes('href')).toBe('/send');
  });

  it('includes a "History" link to /history', async () => {
    const wrapper = await mountLayout();
    const link = wrapper.findAll('.sidebar-nav-item').find((a) => a.text() === 'History');
    expect(link).toBeTruthy();
    expect(link?.attributes('href')).toBe('/history');
  });

  it('includes an "Import credentials" link to /imports/credentials', async () => {
    const wrapper = await mountLayout();
    const link = wrapper.findAll('.sidebar-nav-item').find((a) => a.text() === 'Import credentials');
    expect(link).toBeTruthy();
    expect(link?.attributes('href')).toBe('/imports/credentials');
  });

  it('shows the signed-in user email in the sidebar footer', async () => {
    const wrapper = await mountLayout();
    expect(wrapper.find('.sidebar-footer-email').text()).toBe('test@example.com');
  });
});
