// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick, h, Suspense } from 'vue';

// --- Nuxt composable / global stubs -----------------------------------------
// useFetch is a Nuxt global; under Vitest (node env) we stub it via vi.stubGlobal.
const companies = ref([
  { id: 'c1', name: 'Acme Corp', notes: null, status: 'active', createdAt: new Date().toISOString() },
]);

const refreshMock = vi.fn();
vi.stubGlobal('useFetch', (_url: string) => ({
  data: companies,
  refresh: refreshMock,
}));

vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}));

// NuxtLink stub as a render-function component (no runtime template compiler needed).
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object] } },
  setup(props, { slots }) {
    return () => h('a', { href: String(props.to) }, slots.default?.());
  },
});

// Import AFTER globals are stubbed.
import CompaniesPage from './index.vue';

// Async setup requires a <Suspense> wrapper so the component fully resolves.
async function mountPage() {
  const wrapper = mount(
    defineComponent({
      setup() { return () => h(Suspense, null, { default: () => h(CompaniesPage) }); },
    }),
    { global: { components: { NuxtLink }, stubs: { NuxtLink } } },
  );
  // Flush the async setup promise and Suspense resolution.
  await nextTick();
  await nextTick();
  return wrapper;
}

beforeEach(() => {
  companies.value = [
    { id: 'c1', name: 'Acme Corp', notes: null, status: 'active', createdAt: new Date().toISOString() },
  ];
  refreshMock.mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe('companies page', () => {
  it('renders the company plural label as the page heading', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="page-title"]').text()).toBe('Sites');
  });

  it('lists fetched companies', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="company-row"]').text()).toContain('Acme Corp');
  });

  it('labels the create button with the company singular', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="create-btn"]').text()).toContain('Site');
  });
});
