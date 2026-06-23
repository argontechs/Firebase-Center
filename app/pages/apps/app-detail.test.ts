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

// NuxtLink stub: renders an <a> so we can inspect the href / text content.
const NuxtLink = defineComponent({
  name: 'NuxtLink',
  props: { to: { type: [String, Object] } },
  setup(props, { slots }) {
    return () => h('a', { href: String(props.to) }, slots.default?.());
  },
});

// NuxtPage stub: renders a sentinel so the outlet is present.
const NuxtPage = defineComponent({
  name: 'NuxtPage',
  setup() {
    return () => h('div', { 'data-stub': 'NuxtPage' });
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
    {
      global: {
        plugins: [router],
        components: { NuxtLink, NuxtPage },
        stubs: { NuxtLink, NuxtPage },
      },
    },
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

  it('renders exactly two tab links', async () => {
    const wrapper = await mountPage();
    const tabs = wrapper.findAll('[data-test="app-tab"]');
    expect(tabs).toHaveLength(2);
  });

  it('tab labels are Credentials and Ingest Keys', async () => {
    const wrapper = await mountPage();
    const labels = wrapper.findAll('[data-test="app-tab"]').map((t) => t.text());
    expect(labels).toEqual(['Credentials', 'Ingest Keys']);
  });

  it('tab links point to the correct child routes', async () => {
    const wrapper = await mountPage();
    const hrefs = wrapper.findAll('[data-test="app-tab"]').map((t) => t.attributes('href'));
    expect(hrefs).toEqual([
      '/apps/a1/credentials',
      '/apps/a1/ingest-keys',
    ]);
  });

  it('tab-panel contains a NuxtPage outlet', async () => {
    const wrapper = await mountPage();
    const panel = wrapper.find('[data-test="tab-panel"]');
    expect(panel.exists()).toBe(true);
    expect(panel.find('[data-stub="NuxtPage"]').exists()).toBe(true);
  });

  it('renders a "View targets" quick-link to /targets?appId=a1', async () => {
    const wrapper = await mountPage();
    const link = wrapper.find('[data-test="quick-link-targets"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('View targets');
    expect(link.attributes('href')).toBe('/targets?appId=a1');
  });

  it('renders a "Send to this app" quick-link to /send?appId=a1', async () => {
    const wrapper = await mountPage();
    const link = wrapper.find('[data-test="quick-link-send"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Send to this app');
    expect(link.attributes('href')).toBe('/send?appId=a1');
  });
});
