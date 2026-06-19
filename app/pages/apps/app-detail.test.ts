// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick, h, Suspense } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';

// --- Nuxt composable / global stubs -----------------------------------------
const app = ref({ id: 'a1', companyId: 'c1', name: 'Acme Shopper', notes: null, createdAt: '' });
const refreshMock = vi.fn();

vi.stubGlobal('useFetch', (_url: string) => {
  return { data: app, refresh: refreshMock };
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
import AppDetail from './[id].vue';

// Build a memory router with a route that supplies the :id param.
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/apps/:id', component: AppDetail }],
  });
}

// Async setup requires a <Suspense> wrapper so the component fully resolves.
async function mountPage() {
  const router = makeRouter();
  await router.push('/apps/a1');
  await router.isReady();

  const wrapper = mount(
    defineComponent({
      setup() { return () => h(Suspense, null, { default: () => h(AppDetail) }); },
    }),
    { global: { plugins: [router], components: { NuxtLink }, stubs: { NuxtLink } } },
  );
  await nextTick();
  await nextTick();
  return wrapper;
}

beforeEach(() => {
  app.value = { id: 'a1', companyId: 'c1', name: 'Acme Shopper', notes: null, createdAt: '' };
  refreshMock.mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe('app detail shell', () => {
  it('renders the app name', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="app-title"]').text()).toContain('Acme Shopper');
  });

  it('renders all five tab placeholders', async () => {
    const wrapper = await mountPage();
    const tabs = wrapper.findAll('[data-test="app-tab"]').map((t) => t.text());
    expect(tabs).toEqual(['Credentials', 'Devices', 'Ingest Keys', 'Compose', 'History']);
  });

  it('marks unbuilt tabs as coming soon', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="tab-panel"]').text()).toContain('Coming soon');
  });
});
