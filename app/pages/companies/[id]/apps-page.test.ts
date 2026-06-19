// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick, h, Suspense } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';

// --- Nuxt composable / global stubs -----------------------------------------
const company = ref({ id: 'c1', name: 'Acme Corp', status: 'active', notes: null, createdAt: '' });
const apps = ref([{ id: 'a1', companyId: 'c1', name: 'Acme Shopper', notes: null, createdAt: '' }]);
const refreshMock = vi.fn();

vi.stubGlobal('useFetch', (url: string) => {
  if (url.startsWith('/api/companies/')) return { data: company, refresh: refreshMock };
  if (url.startsWith('/api/apps')) return { data: apps, refresh: refreshMock };
  return { data: ref(null), refresh: refreshMock };
});

vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}));

// NuxtLink stub as a render-function component (no runtime template compiler needed).
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object] } },
  setup(props, { slots }) {
    return () => h('a', { href: String(props.to) }, slots.default?.());
  },
});

// Import AFTER globals are stubbed.
import AppsPage from './apps.vue';

// Build a memory router with a route that supplies the :id param.
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/companies/:id/apps', component: AppsPage }],
  });
}

// Async setup requires a <Suspense> wrapper so the component fully resolves.
async function mountPage() {
  const router = makeRouter();
  await router.push('/companies/c1/apps');
  await router.isReady();

  const wrapper = mount(
    defineComponent({
      setup() { return () => h(Suspense, null, { default: () => h(AppsPage) }); },
    }),
    { global: { plugins: [router], components: { NuxtLink }, stubs: { NuxtLink } } },
  );
  await nextTick();
  await nextTick();
  return wrapper;
}

beforeEach(() => {
  company.value = { id: 'c1', name: 'Acme Corp', status: 'active', notes: null, createdAt: '' };
  apps.value = [{ id: 'a1', companyId: 'c1', name: 'Acme Shopper', notes: null, createdAt: '' }];
  refreshMock.mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe('company apps page', () => {
  it('shows the parent company name and the apps plural label', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Acme Corp');
    expect(wrapper.find('[data-test="apps-title"]').text()).toBe('Apps');
  });

  it('lists apps scoped to the company and links to the app detail', async () => {
    const wrapper = await mountPage();
    const link = wrapper.find('[data-test="app-link"]');
    expect(link.text()).toContain('Acme Shopper');
    expect(link.attributes('href')).toBe('/apps/a1');
  });
});
