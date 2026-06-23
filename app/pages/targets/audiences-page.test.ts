// @vitest-environment happy-dom
/**
 * Task G3: Audiences page component test.
 *
 * Stubs /api/apps/:id/audiences returning two audience rows with counts;
 * asserts the data-test hooks specified in the task spec.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick, h, Suspense } from 'vue';

// --- stub audience list ---------------------------------------------------
const audiencesData = ref([
  {
    id: 'au1',
    appId: 'a1',
    name: 'VIP Android',
    platform: 'android',
    provider: 'fcm',
    tag: 'vip',
    createdBy: null,
    createdAt: new Date().toISOString(),
    count: 42,
  },
  {
    id: 'au2',
    appId: 'a1',
    name: 'All iOS',
    platform: 'ios',
    provider: null,
    tag: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    count: 10,
  },
]);

// useFetch stub — returns audiencesData for audience queries, empty for others.
const refreshMock = vi.fn();
vi.stubGlobal('useFetch', (url: string | (() => string), _opts?: unknown) => {
  const resolved = typeof url === 'function' ? url() : url;
  if (resolved && String(resolved).includes('/audiences')) {
    return { data: audiencesData, refresh: refreshMock };
  }
  return { data: ref(null), refresh: vi.fn() };
});

// $fetch stub — used for mutations (create, delete) and CSRF.
vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ token: 'csrf-tok' }));

// useRoute stub — supplies query params (appId filter).
vi.stubGlobal('useRoute', () => ({
  query: { appId: 'a1' },
  path: '/targets/audiences',
}));

// navigateTo stub
vi.stubGlobal('navigateTo', vi.fn());

// NuxtLink stub
const NuxtLink = defineComponent({
  name: 'NuxtLink',
  props: { to: { type: [String, Object] } },
  setup(props, { slots }) {
    return () => h('a', { href: String(props.to) }, slots.default?.());
  },
});

// Import AFTER globals are stubbed.
import AudiencesPage from './audiences.vue';

async function mountPage() {
  const wrapper = mount(
    defineComponent({
      setup() {
        return () => h(Suspense, null, { default: () => h(AudiencesPage) });
      },
    }),
    {
      global: {
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
  audiencesData.value = [
    {
      id: 'au1',
      appId: 'a1',
      name: 'VIP Android',
      platform: 'android',
      provider: 'fcm',
      tag: 'vip',
      createdBy: null,
      createdAt: new Date().toISOString(),
      count: 42,
    },
    {
      id: 'au2',
      appId: 'a1',
      name: 'All iOS',
      platform: 'ios',
      provider: null,
      tag: null,
      createdBy: null,
      createdAt: new Date().toISOString(),
      count: 10,
    },
  ];
  refreshMock.mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'csrf-tok' });
});

describe('audiences page', () => {
  it('renders one audience-row per audience', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="audience-row"]');
    expect(rows).toHaveLength(2);
  });

  it('shows the audience name in each row', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="audience-row"]');
    expect(rows[0]!.text()).toContain('VIP Android');
    expect(rows[1]!.text()).toContain('All iOS');
  });

  it('shows the audience count in each row', async () => {
    const wrapper = await mountPage();
    const counts = wrapper.findAll('[data-test="audience-count"]');
    expect(counts).toHaveLength(2);
    expect(counts[0]!.text()).toContain('42');
    expect(counts[1]!.text()).toContain('10');
  });

  it('renders a "+ New audience" button', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="new-audience-btn"]').exists()).toBe(true);
  });

  it('reveals the create form when "+ New audience" is clicked', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="audience-name"]').exists()).toBe(false);

    await wrapper.find('[data-test="new-audience-btn"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-test="audience-name"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="platform-select"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="provider-select"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="tag-input"]').exists()).toBe(true);
  });

  it('renders a live preview-count element in the form', async () => {
    const wrapper = await mountPage();
    await wrapper.find('[data-test="new-audience-btn"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-test="preview-count"]').exists()).toBe(true);
  });

  it('renders a delete button per audience row', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="audience-row"]');
    for (const row of rows) {
      expect(row.find('[data-test="delete-audience-btn"]').exists()).toBe(true);
    }
  });
});
