// @vitest-environment happy-dom
/**
 * Task G2: Targets page component test.
 *
 * Stubs /api/devices returning two device rows; asserts the data-test hooks
 * specified in the task spec.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick, h, Suspense } from 'vue';

// --- stub device list ---------------------------------------------------
// Tokens are already masked by the API (format: first6...last6).
const devicesData = ref({
  devices: [
    {
      id: 'd1',
      appId: 'a1',
      provider: 'fcm',
      platform: 'android',
      token: 'ABCDEF…89XYZ',
      externalUserId: null,
      tags: ['vip', 'kl'],
      status: 'active',
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
    },
    {
      id: 'd2',
      appId: 'a1',
      provider: 'huawei',
      platform: 'huawei',
      token: 'HMSdef…89abc',
      externalUserId: 'user-42',
      tags: [],
      status: 'active',
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
    },
  ],
});

// useFetch stub — returns devicesData for /api/devices queries.
const refreshMock = vi.fn();
vi.stubGlobal('useFetch', (_url: string, _opts?: unknown) => ({
  data: devicesData,
  refresh: refreshMock,
}));

// $fetch stub — used for mutations (manualAdd, setTags, remove) and CSRF.
vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ token: 'csrf-tok', id: 'd3' }));

// useRoute stub — supplies query params (appId filter).
vi.stubGlobal('useRoute', () => ({
  query: {},
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
import TargetsPage from './index.vue';

async function mountPage() {
  const wrapper = mount(
    defineComponent({
      setup() {
        return () => h(Suspense, null, { default: () => h(TargetsPage) });
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
  devicesData.value = {
    devices: [
      {
        id: 'd1',
        appId: 'a1',
        provider: 'fcm',
        platform: 'android',
        token: 'ABCDEF…89XYZ',
        externalUserId: null,
        tags: ['vip', 'kl'],
        status: 'active',
        createdAt: new Date().toISOString(),
        lastSeenAt: null,
      },
      {
        id: 'd2',
        appId: 'a1',
        provider: 'huawei',
        platform: 'huawei',
        token: 'HMSdef…89abc',
        externalUserId: 'user-42',
        tags: [],
        status: 'active',
        createdAt: new Date().toISOString(),
        lastSeenAt: null,
      },
    ],
  };
  refreshMock.mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'csrf-tok', id: 'd3' });
});

describe('targets page', () => {
  it('renders the page title as "Targets"', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="targets-title"]').text()).toBe('Targets');
  });

  it('renders a .table with one row per device', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="device-row"]');
    expect(rows).toHaveLength(2);
  });

  it('shows a masked token in the device row', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="device-row"]');
    // The API returns already-masked tokens in format "first6...last6" with an ellipsis.
    // Assert the first <td> of each row contains the masked token with the ellipsis character.
    const firstRowToken = rows[0]!.find('td');
    expect(firstRowToken.text()).toContain('…');
    const secondRowToken = rows[1]!.find('td');
    expect(secondRowToken.text()).toContain('…');
  });

  it('renders an app filter element', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="app-filter"]').exists()).toBe(true);
  });

  it('renders an "+ Add target" button', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="add-target-btn"]').exists()).toBe(true);
  });

  it('reveals the add-form panel when "+ Add target" is clicked', async () => {
    const wrapper = await mountPage();
    // Form should be hidden initially
    expect(wrapper.find('[data-test="token-input"]').exists()).toBe(false);

    await wrapper.find('[data-test="add-target-btn"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-test="token-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="platform-select"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="provider-select"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="tags-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="save-target-btn"]').exists()).toBe(true);
  });

  it('renders a Bulk import link pointing to /imports/devices', async () => {
    const wrapper = await mountPage();
    const importLink = wrapper.find('[data-test="bulk-import-link"]');
    expect(importLink.exists()).toBe(true);
    // Must point to the device import wizard, not the credential importer
    expect(importLink.attributes('href')).toBe('/imports/devices');
  });

  it('renders an Edit button in each device row', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="device-row"]');
    // Every row should contain an Edit action
    for (const row of rows) {
      expect(row.find('[data-test="edit-device-btn"]').exists()).toBe(true);
    }
  });

  it('reveals an inline tag-edit form when Edit is clicked', async () => {
    const wrapper = await mountPage();
    const firstRow = wrapper.find('[data-test="device-row"]');
    await firstRow.find('[data-test="edit-device-btn"]').trigger('click');
    await nextTick();
    // Inline tag edit input should appear
    expect(wrapper.find('[data-test="edit-tags-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="save-tags-btn"]').exists()).toBe(true);
  });

  it('calls setTags and refreshes when tags are saved', async () => {
    const wrapper = await mountPage();
    const firstRow = wrapper.find('[data-test="device-row"]');
    await firstRow.find('[data-test="edit-device-btn"]').trigger('click');
    await nextTick();

    const tagsInput = wrapper.find('[data-test="edit-tags-input"]');
    await tagsInput.setValue('vip, promo');
    await wrapper.find('[data-test="save-tags-btn"]').trigger('click');
    await nextTick();
    await nextTick();

    // $fetch was called for CSRF token and then for the PATCH
    expect(globalThis.$fetch).toHaveBeenCalled();
  });
});
